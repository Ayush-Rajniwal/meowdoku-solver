/** Coalesces key presses; a request during a cycle runs once immediately afterward. */
export class ManualTrigger {
  private pending = false;
  private wake: (() => void) | undefined;
  request(): void {
    if (this.wake) {
      const wake = this.wake;
      this.wake = undefined;
      wake();
    } else this.pending = true;
  }
  wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    if (this.pending) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        if (this.wake === finish) this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      this.wake = finish;
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  }
}
