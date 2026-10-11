import { getPasskeyPrfOutput, type PasskeyCredentialTransport, type WebAuthnClient } from '@category-labs/mera'
import { hexToBytes, sha256, toBytes } from 'viem'

const SALTS = {
  encryption: hexToBytes(sha256(toBytes('ponygogogo/collection/encryption/v0.1'))),
  identity: hexToBytes(sha256(toBytes('ponygogogo/collection/identity/v0.1'))),
}

/** Independent collection purposes; only the active credential may supply their key material. */
export async function collectionPrf(purpose: keyof typeof SALTS, rpId: string,
  credential: { credentialId: string; transports?: readonly PasskeyCredentialTransport[] }, webAuthnClient?: WebAuthnClient) {
  const asserted = await getPasskeyPrfOutput({
    rpId, credential: { credentialId: credential.credentialId, ...(credential.transports ? { transports: credential.transports } : {}) },
    prfSalt: SALTS[purpose], ...(webAuthnClient ? { webAuthnClient } : {}),
  })
  if (asserted.credentialId !== credential.credentialId) {
    asserted.prfOutput.fill(0)
    throw new Error('CREDENTIAL_MISMATCH')
  }
  return asserted.prfOutput
}
