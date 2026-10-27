/** Memoize each immutable message separately: streaming a new reply must not
 * reparse every old code block. Weak keys release replaced/deleted messages.
 * Callers include every non-message visual input in dependencies and use
 * stable, current handlers for actions (never a stale workspace closure). */
export class MessageRenderCache<T extends object, R> {
  private cache = new WeakMap<T, { dependencies: readonly unknown[]; result: R }>();

  render(message: T, dependencies: readonly unknown[], render: () => R): R {
    const cached = this.cache.get(message);
    if (cached && cached.dependencies.length === dependencies.length
      && dependencies.every((value, index) => Object.is(value, cached.dependencies[index]))) return cached.result;
    const result = render();
    this.cache.set(message, { dependencies, result });
    return result;
  }
}
