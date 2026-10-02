// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentBudget} from "./AgentBudget.sol";
import {IPaidRaceSolver} from "./IPaidRaceSolver.sol";
import {PaidCardRules} from "./PaidCardRules.sol";
import {PaidSeed} from "./PaidSeed.sol";
import {PonyVault} from "./PonyVault.sol";
import {RacePayout} from "./RacePayout.sol";
import {RandomAnchor} from "./RandomAnchor.sol";

/// @notice 会话协议 v2: paid sessions, choice records, random-anchor sealing, authoritative settlement and forfeits.
/// There are no refunds: a session that can never settle is forfeited by its player (payout 0).
/// @dev The race rules live in the immutable solver; this contract only builds its input from on-chain facts
/// (seed, T0, transaction seconds and blocks, sealed block hashes) and pays by the solver's settlement rank.
/// chooseCard does not run the solver: whether a stored choice takes effect is judged by the settlement solve
/// (有奖规则 v3), which ignores a rule-breaking choice.
contract PonyGame is Ownable2Step, AgentBudget {
    error InvalidConfiguration();
    error EntryPaused();
    error InvalidEntry();
    error ActiveSession();
    error UnknownSession();
    error SessionNotOpen();
    error NotSessionPlayer();
    error InvalidCheckpoint();
    error InvalidCard();
    error TooManyRefreshes();
    error InvalidRefreshSlot();
    error RaceNotFinished(uint256 elapsedMs, uint32 finishWall);
    error InvalidSolverResult();
    error ForfeitNotAllowed();
    error ForfeitTooEarly(uint256 availableAt);
    error ForfeitProbeGasTooLow();
    error RenounceDisabled();

    uint8 public constant STATE_NONE = 0;
    uint8 public constant STATE_OPEN = 1;
    uint8 public constant STATE_SETTLED = 2;
    uint8 public constant STATE_FORFEITED = 3;
    uint8 public constant CHECKPOINTS = 3;
    uint8 public constant MAX_CARD_ID = PaidCardRules.CARD_COUNT;
    uint8 public constant MAX_REFRESHES = 3;
    uint8 public constant MAX_REFRESH_SLOT = 2;
    /// @notice SessionForfeited reasons.
    uint8 public constant FORFEIT_ANCHOR_LOST = 1;
    uint8 public constant FORFEIT_SOLVER_FAULT = 2;
    /// @notice The owner's solver-fault forfeit waits this long after T0: a finished race is settleable within
    /// seconds, and an unsealed anchor makes the session publicly forfeitable in ~47 min anyway.
    uint256 public constant FORFEIT_DELAY = 1 days;
    /// @notice Gas the owner's forfeit gives the settlement preview. The verified worst solve is far below it and a
    /// settlement transaction under Monad's 30M limit cannot give the solver more, so a preview that still fails is a
    /// solver fault, not a starved call.
    uint256 public constant FORFEIT_PROBE_GAS = 29_000_000;

    /// @dev Two slots. blockNumber == 0 means no transaction at this checkpoint: a session never opens in block 0,
    /// so no choice lands there.
    struct Choice {
        uint64 blockNumber;
        uint32 txSec;
        uint8 cardId;
        uint8 refreshCount;
        uint24 refreshSlots; // slot i in bits [8i, 8i+8)
        bytes32 anchor; // 0 = not sealed yet
    }

    /// @dev Slot 0 packs player, T0 and the small fields; stake is derived from stakeTier.
    struct Session {
        address player;
        uint64 openedAt;
        uint8 playerHorseId;
        uint8 stakeTier;
        uint8 state;
        uint8 lastCheckpoint;
        uint64 openedBlock;
        bytes32 seed;
        bytes32 openAnchor;
        Choice[3] choices;
    }

    struct ChoiceView {
        bool present;
        uint32 txSec;
        uint64 blockNumber;
        uint8 cardId;
        uint8[] refreshSlots;
        bytes32 anchor;
    }

    struct SessionView {
        address player;
        uint8 state;
        uint8 playerHorseId;
        uint8 stakeTier;
        uint256 stake;
        uint64 openedAt;
        uint64 openedBlock;
        bytes32 seed;
        bytes32 openAnchor;
        uint8 lastCheckpoint;
        ChoiceView[3] choices;
    }

    IPaidRaceSolver public immutable solver;
    bytes32 public immutable rulesetHash;
    PonyVault public vault;
    bool public entryPaused = true;
    /// @notice Last nonce used by each account; the next session uses nonces[player] + 1.
    mapping(address => uint256) public nonces;
    /// @notice The account's unfinished session, or 0.
    mapping(address => bytes32) public sessionOf;
    mapping(bytes32 => Session) internal _sessions;

    event VaultBound(address indexed vault);
    event EntryPauseChanged(bool paused);
    event SessionOpened(
        bytes32 indexed sessionId,
        address indexed player,
        uint8 horseId,
        uint256 stake,
        bytes32 seed,
        uint64 openedAt,
        uint64 openedBlock,
        bytes32 rulesetHash
    );
    event CardChosen(
        bytes32 indexed sessionId,
        address indexed player,
        uint8 checkpoint,
        uint8 cardId,
        uint8[] refreshSlots,
        uint32 txSec,
        uint64 blockNumber
    );
    event RandomAnchorSealed(bytes32 indexed sessionId, uint64 sourceBlock, bytes32 anchor);
    /// @dev acquired[k-1] is the card the player actually took at checkpoint k (0 = none, e.g. an ignored choice).
    event SessionSettled(
        bytes32 indexed sessionId,
        address indexed player,
        uint32[5] finishTime,
        uint8[5] rawOrder,
        uint8[5] settlementOrder,
        uint8 playerSettlementRank,
        uint256 payout,
        bytes32 digest,
        uint8[3] acquired
    );
    event SessionForfeited(bytes32 indexed sessionId, address indexed player, uint256 stake, uint8 reason);

    constructor(address owner_, IPaidRaceSolver solver_) Ownable(owner_) {
        if (address(solver_).code.length == 0) revert InvalidConfiguration();
        bytes32 ruleset = solver_.rulesetHash();
        if (ruleset == bytes32(0)) revert InvalidConfiguration();
        solver = solver_;
        rulesetHash = ruleset;
    }

    // ---------------------------------------------------------------- admin

    function bindVault(PonyVault vault_) external onlyOwner {
        if (address(vault) != address(0) || address(vault_) == address(0) || vault_.game() != address(this)) {
            revert InvalidConfiguration();
        }
        vault = vault_;
        emit VaultBound(address(vault_));
    }

    /// @notice Pauses new entries only; open sessions still choose, settle and forfeit.
    function setEntryPaused(bool paused) external onlyOwner {
        entryPaused = paused;
        emit EntryPauseChanged(paused);
    }

    /// @dev forfeitSession reason 2 is the only way out of a solver fault, so the owner role cannot be dropped.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- agent budget

    function configureAgentBudget(uint64 expiry, uint256 maxStake) external {
        _configureAgentBudget(msg.sender, expiry, maxStake);
    }

    function revokeAgentBudget() external {
        _revokeAgentBudget(msg.sender);
    }

    // ---------------------------------------------------------------- session lifecycle

    function openSession(uint8 horseId, uint256 stake) external returns (bytes32 sessionId) {
        return _open(msg.sender, horseId, stake);
    }

    /// @notice The only Game function allowed in Alchemy's agent session permission.
    function openAgentSession(uint8 horseId, uint256 stake) external returns (bytes32 sessionId) {
        _consumeAgentBudget(msg.sender, stake);
        return _open(msg.sender, horseId, stake);
    }

    /// @notice Records the player's transaction (cardId 0 = active forfeit) for `checkpoint` 1..3 at this block's
    /// second, and seals the earlier anchors that are readable now. Only cheap shape checks: whether the choice takes
    /// effect is judged by the settlement solve, which ignores one that breaks a rule.
    function chooseCard(bytes32 sessionId, uint8 checkpoint, uint8 cardId, uint8[] calldata refreshSlots) external {
        Session storage session = _openSession(sessionId);
        if (msg.sender != session.player) revert NotSessionPlayer();
        if (checkpoint == 0 || checkpoint > CHECKPOINTS || checkpoint <= session.lastCheckpoint) {
            revert InvalidCheckpoint();
        }
        if (cardId > MAX_CARD_ID) revert InvalidCard();
        if (refreshSlots.length > MAX_REFRESHES) revert TooManyRefreshes();
        for (uint256 i; i < refreshSlots.length; ++i) {
            if (refreshSlots[i] > MAX_REFRESH_SLOT) revert InvalidRefreshSlot();
        }

        _sealReadable(sessionId, session);
        uint32 txSec = uint32(block.timestamp - session.openedAt);
        Choice storage choice = session.choices[checkpoint - 1];
        choice.blockNumber = uint64(block.number);
        choice.txSec = txSec;
        choice.cardId = cardId;
        choice.refreshCount = uint8(refreshSlots.length);
        choice.refreshSlots = _packSlots(refreshSlots);
        session.lastCheckpoint = checkpoint;
        emit CardChosen(sessionId, msg.sender, checkpoint, cardId, refreshSlots, txSec, uint64(block.number));
    }

    /// @notice Seals every required anchor that is readable now. Anyone may call; unreadable anchors are skipped.
    function sealAnchors(bytes32 sessionId) external returns (uint256 count) {
        return _sealReadable(sessionId, _openSession(sessionId));
    }

    /// @notice Anyone may settle once the player's canonical finish is in the past and every required anchor is
    /// sealed or still readable. No deadline once sealed.
    function settleSession(bytes32 sessionId) external returns (uint256 payout) {
        Session storage session = _openSession(sessionId);
        IPaidRaceSolver.RaceInput memory input = _raceInput(session);
        _seal(sessionId, session, input);
        IPaidRaceSolver.RaceResult memory result = solver.solve(input);

        uint8 horseId = session.playerHorseId;
        uint256 elapsedMs = (block.timestamp - session.openedAt) * 1000;
        if (elapsedMs < result.finishWall[horseId]) revert RaceNotFinished(elapsedMs, result.finishWall[horseId]);
        uint8 rank = result.playerSettlementRank;
        if (rank == 0 || rank > 5 || result.settlementOrder[rank - 1] != horseId) revert InvalidSolverResult();
        payout = RacePayout.gross(stakeForTier(session.stakeTier), payoutMultipliers()[rank - 1]);

        address player = session.player;
        session.state = STATE_SETTLED;
        delete sessionOf[player];
        emit SessionSettled(
            sessionId,
            player,
            result.finishTime,
            result.rawOrder,
            result.settlementOrder,
            rank,
            payout,
            result.digest,
            result.acquired
        );
        vault.settleStake(sessionId, payout);
    }

    /// @notice Closes a session that can never settle with payout 0: the stake goes to house liquidity and the
    /// reserve is released. Anyone may call once a required anchor is unsealed and past the history window (reason 1).
    /// Otherwise only the owner, FORFEIT_DELAY after T0, with every anchor available, when the settlement preview
    /// fails within FORFEIT_PROBE_GAS (reason 2: the solver reverts or returns an unpayable result). Mutually exclusive
    /// with settlement.
    function forfeitSession(bytes32 sessionId) external {
        Session storage session = _openSession(sessionId);
        uint8 reason = FORFEIT_ANCHOR_LOST;
        if (!_anchorLost(session)) {
            if (msg.sender != owner()) revert ForfeitNotAllowed();
            uint256 availableAt = uint256(session.openedAt) + FORFEIT_DELAY;
            if (block.timestamp < availableAt) revert ForfeitTooEarly(availableAt);
            _raceInput(session); // reverts AnchorUnavailable while an anchor is still pending (current block)
            // The CALL passes at most 63/64 of what is left; demand enough that the probe gets its full budget.
            if (gasleft() < FORFEIT_PROBE_GAS + FORFEIT_PROBE_GAS / 63 + 20_000) revert ForfeitProbeGasTooLow();
            try this.previewSettlement{gas: FORFEIT_PROBE_GAS}(sessionId) {
                revert ForfeitNotAllowed();
            } catch {
                reason = FORFEIT_SOLVER_FAULT;
            }
        }
        address player = session.player;
        session.state = STATE_FORFEITED;
        delete sessionOf[player];
        emit SessionForfeited(sessionId, player, stakeForTier(session.stakeTier), reason);
        vault.settleStake(sessionId, 0);
    }

    // ---------------------------------------------------------------- views

    function getSession(bytes32 sessionId) external view returns (SessionView memory view_) {
        Session storage session = _sessions[sessionId];
        view_.player = session.player;
        view_.state = session.state;
        view_.playerHorseId = session.playerHorseId;
        view_.stakeTier = session.stakeTier;
        view_.stake = session.stakeTier == 0 ? 0 : stakeForTier(session.stakeTier);
        view_.openedAt = session.openedAt;
        view_.openedBlock = session.openedBlock;
        view_.seed = session.seed;
        view_.openAnchor = session.openAnchor;
        view_.lastCheckpoint = session.lastCheckpoint;
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            view_.choices[i] = ChoiceView(
                choice.blockNumber != 0,
                choice.txSec,
                choice.blockNumber,
                choice.cardId,
                _unpackSlots(choice),
                choice.anchor
            );
        }
    }

    /// @notice The exact solver input settlement would use now, with unsealed but readable anchors filled in.
    /// Reverts AnchorUnavailable while any required anchor is not readable.
    function raceInput(bytes32 sessionId) external view returns (IPaidRaceSolver.RaceInput memory) {
        return _raceInput(_existingSession(sessionId));
    }

    /// @notice Solver result and payout for an open session, and the first timestamp settlement accepts.
    function previewSettlement(bytes32 sessionId)
        external
        view
        returns (IPaidRaceSolver.RaceResult memory result, uint256 payout, uint256 settleableAt)
    {
        Session storage session = _openSession(sessionId);
        result = solver.solve(_raceInput(session));
        uint8 rank = result.playerSettlementRank;
        if (rank == 0 || rank > 5 || result.settlementOrder[rank - 1] != session.playerHorseId) {
            revert InvalidSolverResult();
        }
        payout = RacePayout.gross(stakeForTier(session.stakeTier), payoutMultipliers()[rank - 1]);
        settleableAt = uint256(session.openedAt) + (uint256(result.finishWall[session.playerHorseId]) + 999) / 1000;
    }

    /// @notice Whether forfeitSession would succeed now, and with which reason: (true, 1) for anyone; (true, 2) for
    /// the owner, given a transaction that leaves the probe FORFEIT_PROBE_GAS.
    function canForfeit(bytes32 sessionId) external view returns (bool, uint8) {
        Session storage session = _sessions[sessionId];
        if (session.state != STATE_OPEN) return (false, 0);
        if (_anchorLost(session)) return (true, FORFEIT_ANCHOR_LOST);
        if (block.timestamp < uint256(session.openedAt) + FORFEIT_DELAY || !_anchorsReadable(session)) {
            return (false, 0);
        }
        try this.previewSettlement(sessionId) {
            return (false, 0);
        } catch {
            return (true, FORFEIT_SOLVER_FAULT);
        }
    }

    /// @notice Paid stake tiers (exact wei): 0.3 / 1 / 5 / 10 MON use personality ranges 1..4; 0 = not a paid stake.
    function stakeTier(uint256 stake) public pure returns (uint8) {
        if (stake == 0.3 ether) return 1;
        if (stake == 1 ether) return 2;
        if (stake == 5 ether) return 3;
        if (stake == 10 ether) return 4;
        return 0;
    }

    function stakeForTier(uint8 tier) public pure returns (uint256) {
        if (tier == 1) return 0.3 ether;
        if (tier == 2) return 1 ether;
        if (tier == 3) return 5 ether;
        if (tier == 4) return 10 ether;
        revert InvalidEntry();
    }

    /// @notice Gross return in bps by settlement rank 1..5, stake included.
    function payoutMultipliers() public pure returns (uint16[5] memory) {
        return [uint16(30_000), 15_000, 10_000, 0, 0];
    }

    // ---------------------------------------------------------------- internals

    function _open(address player, uint8 horseId, uint256 stake) private returns (bytes32 sessionId) {
        if (entryPaused) revert EntryPaused();
        PonyVault vault_ = vault;
        if (address(vault_) == address(0)) revert InvalidConfiguration();
        uint8 tier = stakeTier(stake);
        if (horseId >= 5 || tier == 0) revert InvalidEntry();
        if (sessionOf[player] != bytes32(0)) revert ActiveSession();

        uint256 nonce = ++nonces[player];
        sessionId = keccak256(abi.encode(address(this), block.chainid, player, nonce));
        bytes32 seed = PaidSeed.derive(block.chainid, address(this), player, nonce);
        Session storage session = _sessions[sessionId];
        session.player = player;
        session.openedAt = uint64(block.timestamp);
        session.playerHorseId = horseId;
        session.stakeTier = tier;
        session.state = STATE_OPEN;
        session.openedBlock = uint64(block.number);
        session.seed = seed;
        sessionOf[player] = sessionId;
        emit SessionOpened(
            sessionId, player, horseId, stake, seed, uint64(block.timestamp), uint64(block.number), rulesetHash
        );
        vault_.lockStake(sessionId, player, stake, RacePayout.maximum(stake, payoutMultipliers()));
    }

    /// @dev Builds the solver input from storage; every present choice carries its anchor. Reverts
    /// AnchorUnavailable if any required anchor is neither sealed nor readable.
    function _raceInput(Session storage session) private view returns (IPaidRaceSolver.RaceInput memory input) {
        input.seed = session.seed;
        input.stakeTier = session.stakeTier;
        input.playerHorseId = session.playerHorseId;
        bytes32 openAnchor = session.openAnchor;
        input.openAnchor = openAnchor != bytes32(0) ? openAnchor : RandomAnchor.read(session.openedBlock);
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            uint64 sourceBlock = choice.blockNumber;
            if (sourceBlock == 0) continue;
            bytes32 anchor = choice.anchor;
            input.choices[i] = IPaidRaceSolver.ChoiceInput(
                true,
                choice.txSec,
                choice.cardId,
                _unpackSlots(choice),
                anchor != bytes32(0) ? anchor : RandomAnchor.read(sourceBlock)
            );
        }
    }

    /// @dev Seals every required anchor readable now (open block and stored choices); never reverts.
    function _sealReadable(bytes32 sessionId, Session storage session) private returns (uint256 count) {
        if (session.openAnchor == bytes32(0)) {
            (bool ok, bytes32 hash) = RandomAnchor.tryRead(session.openedBlock);
            if (ok) {
                session.openAnchor = hash;
                emit RandomAnchorSealed(sessionId, session.openedBlock, hash);
                ++count;
            }
        }
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            if (choice.blockNumber == 0 || choice.anchor != bytes32(0)) continue;
            (bool ok, bytes32 hash) = RandomAnchor.tryRead(choice.blockNumber);
            if (ok) {
                choice.anchor = hash;
                emit RandomAnchorSealed(sessionId, choice.blockNumber, hash);
                ++count;
            }
        }
    }

    /// @dev Stores the anchors `_raceInput` had to read.
    function _seal(bytes32 sessionId, Session storage session, IPaidRaceSolver.RaceInput memory input) private {
        if (session.openAnchor == bytes32(0)) {
            session.openAnchor = input.openAnchor;
            emit RandomAnchorSealed(sessionId, session.openedBlock, input.openAnchor);
        }
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            if (choice.blockNumber == 0 || choice.anchor != bytes32(0)) continue;
            choice.anchor = input.choices[i].anchor;
            emit RandomAnchorSealed(sessionId, choice.blockNumber, input.choices[i].anchor);
        }
    }

    /// @dev Every required anchor is sealed or readable now (none pending in the current block, none lost).
    function _anchorsReadable(Session storage session) private view returns (bool) {
        if (session.openAnchor == bytes32(0)) {
            (bool ok,) = RandomAnchor.tryRead(session.openedBlock);
            if (!ok) return false;
        }
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            if (choice.blockNumber == 0 || choice.anchor != bytes32(0)) continue;
            (bool ok,) = RandomAnchor.tryRead(choice.blockNumber);
            if (!ok) return false;
        }
        return true;
    }

    function _anchorLost(Session storage session) private view returns (bool) {
        if (session.openAnchor == bytes32(0) && RandomAnchor.isLost(session.openedBlock)) return true;
        for (uint256 i; i < CHECKPOINTS; ++i) {
            Choice storage choice = session.choices[i];
            if (choice.blockNumber != 0 && choice.anchor == bytes32(0) && RandomAnchor.isLost(choice.blockNumber)) {
                return true;
            }
        }
        return false;
    }

    function _existingSession(bytes32 sessionId) private view returns (Session storage session) {
        session = _sessions[sessionId];
        if (session.state == STATE_NONE) revert UnknownSession();
    }

    function _openSession(bytes32 sessionId) private view returns (Session storage session) {
        session = _existingSession(sessionId);
        if (session.state != STATE_OPEN) revert SessionNotOpen();
    }

    function _packSlots(uint8[] calldata slots) private pure returns (uint24 packed) {
        for (uint256 i; i < slots.length; ++i) {
            packed |= uint24(uint256(slots[i]) << (8 * i));
        }
    }

    function _unpackSlots(Choice storage choice) private view returns (uint8[] memory slots) {
        uint256 count = choice.refreshCount;
        uint24 packed = choice.refreshSlots;
        slots = new uint8[](count);
        for (uint256 i; i < count; ++i) {
            slots[i] = uint8(packed >> (8 * i));
        }
    }
}
