import { AsyncLocalStorage } from "node:async_hooks";

const calls = new AsyncLocalStorage<() => Promise<void>>();

export const beforeProviderCall = async () => {
  await calls.getStore()?.();
};

// The caller already reserved the first request; count all nested calls and corrections too.
export const withProviderCalls = <T>(
  reserve: () => Promise<void>,
  action: () => Promise<T>,
) => {
  let first = true;
  return calls.run(async () => {
    if (first) {
      first = false;
      return;
    }
    await reserve();
  }, action);
};
