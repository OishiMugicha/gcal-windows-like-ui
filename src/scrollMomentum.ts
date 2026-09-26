interface Sample { time: number; speed: number; }
const BUCKET_MS = 16;
const GESTURE_GAP_MS = 150;

// Wheel events don't identify momentum. Fit declining speed, rather than
// treating a small per-event delta as evidence that a gesture has ended.
export class ScrollMomentum {
  private lastTime = -Infinity;
  private direction = 0;
  private bucketStart = 0;
  private distance = 0;
  private samples: Sample[] = [];
  private candidate: number | undefined;
  private settling = false;
  private accelerationBase = 0;
  private accelerationCount = 0;

  reset() {
    this.lastTime = -Infinity; this.direction = 0;
    this.samples = []; this.distance = 0; this.candidate = undefined;
    this.settling = false; this.accelerationCount = 0; this.accelerationBase = 0;
  }

  push(delta: number, now: number, position: number, width: number): { ignore: boolean; target?: number } {
    const direction = Math.sign(delta);
    if (now - this.lastTime > GESTURE_GAP_MS || direction !== this.direction) {
      this.reset(); this.direction = direction; this.lastTime = now; this.bucketStart = now;
      // The first event has no known duration; follow it but don't fit it.
      return { ignore: false };
    }
    const elapsed = now - this.lastTime;
    let cursor = this.lastTime;
    this.lastTime = now;
    if (elapsed <= 0) { this.distance += Math.abs(delta); return { ignore: this.settling }; }
    const speed = Math.abs(delta) / elapsed;
    let resumed = false, target: number | undefined;
    while (cursor < now) {
      const end = Math.min(now, this.bucketStart + BUCKET_MS);
      this.distance += speed * (end - cursor); cursor = end;
      if (end < this.bucketStart + BUCKET_MS) break;
      const sample = { time: end, speed: this.distance / BUCKET_MS };
      this.bucketStart = end; this.distance = 0;

      // Compare both accelerating samples with the same pre-push baseline.
      const previous = this.samples.at(-1)?.speed ?? sample.speed;
      if (!this.accelerationCount) this.accelerationBase = previous;
      this.accelerationCount = sample.speed > this.accelerationBase * 1.5 ? this.accelerationCount + 1 : 0;
      if (this.accelerationCount >= 2) {
        this.samples = []; this.candidate = undefined; this.settling = false;
        this.accelerationCount = 0; resumed = true;
      }
      this.samples.push(sample);
      this.samples = this.samples.filter(s => end - s.time <= 80);
      if (this.settling || resumed) continue;
      const remaining = this.remaining();
      if (remaining === undefined || remaining > width) { this.candidate = undefined; continue; }
      // Evaluate each bucket at its own position, even for sparse wheel input.
      const atEnd = position + delta - direction * speed * (now - end);
      const day = Math.round((atEnd + direction * remaining) / width);
      if (this.candidate === day) { target = day * width; this.settling = true; }
      this.candidate = day;
    }
    return { ignore: this.settling, ...(target === undefined ? {} : { target }) };
  }

  private remaining(): number | undefined {
    const samples = this.samples;
    if (samples.length < 4 || samples.at(-1)!.time - samples[0].time < 48
      || samples.at(-1)!.speed > samples[0].speed * 0.8 || samples.some(s => s.speed <= 0)) return;
    // log(speed) = intercept + slope * time; the exponential's integral
    // from now to infinity is current fitted speed / -slope.
    const last = samples.at(-1)!.time;
    const x = samples.map(s => s.time - last), y = samples.map(s => Math.log(s.speed));
    const meanX = x.reduce((a, b) => a + b, 0) / x.length;
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    const slope = x.reduce((sum, v, i) => sum + (v - meanX) * (y[i] - meanY), 0)
      / x.reduce((sum, v) => sum + (v - meanX) ** 2, 0);
    if (slope >= 0) return;
    // Bucket averages describe their midpoints, eight milliseconds earlier.
    return Math.exp(meanY - slope * meanX + slope * BUCKET_MS / 2) / -slope;
  }
}
