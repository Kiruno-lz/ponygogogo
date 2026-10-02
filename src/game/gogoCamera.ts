/** 仅表现层持有；点击密度与构图偏移不进入 RaceState 或求解输入。 */
export class GogoCameraMotion {
  private density = 0
  private offset = 0

  get offsetRatio(): number { return this.offset }

  press(): void {
    this.density = Math.min(1, this.density + .22)
  }

  update(deltaMs: number): void {
    const dt = Math.max(0, deltaMs)
    const decay = Math.exp(-dt / 1000)
    const response = Math.exp(-dt / 800)
    // 解析积分：点击密度以 1 s 衰减，镜头以 0.8 s 跟随；避免按帧近似导致帧率差异。
    this.offset = Math.max(0, Math.min(1,
      this.offset * response + this.density * 5 * (decay - response)))
    this.density *= decay
    if (this.offset < .0001 && this.density < .0001) this.reset()
  }

  reset(): void {
    this.density = 0
    this.offset = 0
  }
}
