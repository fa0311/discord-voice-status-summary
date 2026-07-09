/**
 * 「同じキーの実行が終わるまで、後から来た同じキーの実行は行わず null を返す」ガードを作る。
 * speaking start のような同一イベントの連続発火を 1 回の実行にまとめるために使う。
 */
export const createDropWhileRunning = <Key>() => {
  const running = new Set<Key>();
  return async <Result>(key: Key, task: () => Promise<Result>): Promise<Result | null> => {
    if (running.has(key)) return null;
    running.add(key);
    return task().finally(() => running.delete(key));
  };
};
