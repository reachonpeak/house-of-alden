/* jsdom has no Web Animations API; animations finish at once in tests. */
export function animate() {
  const finished = Promise.resolve();
  return { finished, then: (resolve) => finished.then(resolve), stop() {}, cancel() {} };
}
