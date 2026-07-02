// Iterate a SuperIterable using (note the `for await`, and `await superIterable`):
//    | 
//    | for await (const val of await superIterable)
//    |   console.log(val);
//    | 
export type SuperIterable<T> = Iterable<T> | AsyncIterable<T> | Promise<Iterable<T>> | Promise<AsyncIterable<T>>;

export const superToArr = async <T>(iterable: SuperIterable<T> | Promise<SuperIterable<T>>) => {
  
  const results: T[] = [];
  for await (const val of await iterable)
    results.push(val);
  return results;
  
};

const v0: SuperIterable<string> = (      function*() { yield 'a'; yield 'b'; })();
void v0;

const v1: SuperIterable<string> = (async function*() { yield 'a'; yield 'b'; })();
void v1;

const v2: SuperIterable<string> = Promise.resolve([ 'a', 'b', 'c' ]);
void v2;