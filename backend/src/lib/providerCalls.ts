import { AsyncLocalStorage } from "node:async_hooks";

const calls = new AsyncLocalStorage<() => Promise<void>>();

export const beforeProviderCall = async () => {
  await calls.getStore()?.();
};

// Each provider request reserves once, including the first and any corrections.
export const withProviderCalls = <T>(
  reserve: () => Promise<void>,
  action: () => Promise<T>,
) => calls.run(reserve, action);
