// Iterate a SuperIterable using (note the `for await`, and `await superIterable`):
//    | 
//    | for await (const val of await superIterable)
//    |   console.log(val);
//    | 
export type SuperIterable<T> = Iterable<T> | Promise<Iterable<T>> | AsyncIterable<T>;

export const superToArr = async <T>(iterable: SuperIterable<T>) => {
  
  const results: T[] = [];
  for await (const val of await iterable)
    results.push(val);
  return results;
  
}