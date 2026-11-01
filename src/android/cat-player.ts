import type { TapAction } from "../levels/play-plan.ts";

export interface PlayerDevice {
  tap(x: number, y: number): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}
/** Places a solved plan. No cross marks, retries, or extra taps. */
export async function placeCats(
  actions: readonly TapAction[],
  device: PlayerDevice,
  afterPlacement: (action: TapAction) => void | Promise<void> = () => {},
): Promise<void> {
  for (const action of actions) {
    await device.tap(action.x, action.y);
    await device.tap(action.x, action.y);
    await device.wait(700);
    await afterPlacement(action);
  }
}
