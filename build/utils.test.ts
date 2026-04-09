import '@gershy/clearing';

const { skip, inCls, getCls, getClsName } = clearing;
const count: typeof cl.count = cl.count;
const toArr: typeof cl.toArr = cl.toArr;
const has:   typeof cl.has   = cl.has;
const mod:   typeof cl.mod   = cl.mod;
const limn:  typeof cl.limn  = cl.limn;

export const cmpAny = Symbol('@gershy/test/cmp/any');

export const equal = (v0: any, v1: any, path: (string | number)[] = []): { equal: true } | { equal: false, path: (string | number)[], [K: string]: any } => {
  
  if (v0 === v1)                      return { equal: true };
  if (v0 == null || v1 == null)       return { equal: false, path, reason: 'identity', v0, v1 };
  if (v0 === cmpAny || v1 === cmpAny) return { equal: true };
  
  const cls0 = getCls(v0);
  const cls1 = getCls(v1);
  
  if (cls0 !== cls1)    return { equal: false, path, reason: 'class', cls0: getClsName(v0), cls1: getClsName(v1) };
  if (cls0 === Number)  return { equal: false, path, reason: 'identity', v0, v1 };
  if (cls0 === Boolean) return { equal: false, path, reason: 'identity', v0, v1 };
  
  if (cls0 === String)  {
    
    let mismatchInd = 0;
    while (v0[mismatchInd] === v1[mismatchInd]) mismatchInd++;
    if (v0.length > 100 || v1.length > 100) {
      
      [ v0, v1 ] = [ v0, v1 ].map(v => {
        
        return [
          v.slice(0, mismatchInd),
          `<MISMATCH>${v[mismatchInd] ?? '[eof]'}</MISMATCH>`,
          v.slice(mismatchInd + 1)
        ].join('');
        
      });
      
    }
    
    return { equal: false, path, reason: 'identity', mismatchInd, v0, v1 };
    
  }
  
  if (cls0 === Array) {
    
    const len0 = v0[count]();
    const len1 = v1[count]();
    if (len0 !== len1) return { equal: false, path, reason: 'arr size', len0, len1 };
    
    for (let i = 0; i < len0; i++) {
      const eq = equal(v0[i], v1[i], [ ...path, i ]);
      if (!eq.equal) return eq;
    }
    
    return { equal: true };
    
  }
  
  if (cls0 === Object) {
    
    const keys0 = v0[toArr]((v, k) => k).sort();
    const keys1 = v1[toArr]((v, k) => k).sort();
    if (!equal(keys0, keys1).equal) return { equal: false, path, reason: 'obj keys', keys0, keys1 };
    
    for (const k in v0) {
      if (!v1[has](k)) return { equal: false, path: [ ...path, k ], reason: 'obj key', key: k, obj0: 'present', obj1: 'absent' } ;
      
      const eq = equal(v0[k], v1[k], [ ...path, k ]);
      if (!eq.equal) return eq;
      
    }
    return { equal: true };
    
  }
  
  if (cls0 === Set) {
    
    if (v0.size !== v1.size) return { equal: false, path, reason: 'set size', len0: v0.size, len1: v1.size };
    for (const v of v0)
      if (!v1.has(v))
        return { equal: false, path, reason: 'set inclusion', val: v, set0: 'present', set1: 'absent' };
    
    return { equal: true };
    
  }
  
  if (cls0 === Map) {
    
    if (v0.size !== v1.size) return { equal: false, path, reason: 'map size', len0: v0.size, len1: v1.size };
    
    for (const [ k, v ] of v0) {
      if (!v1.has(k)) return { equal: false, path: [ ...path, k ], reason: 'map key', key: k, map0: 'present', map1: 'absent' };
      
      const eq = equal(v, v1.get(k), [ ...path, k ]);
      if (!eq.equal) return eq;
    }
    
    return { equal: true };
    
  }
  
  if (cls0 === ArrayBuffer) return equal([ ...new Uint8Array(v0) ], [ ...new Uint8Array(v1) ], [ ...path, '<number[]>' ])
  
  if (ArrayBuffer.isView(v0)) return equal(
    v0.buffer.slice(v0.byteOffset, v0.byteOffset + v0.byteLength),
    v1.buffer.slice(v1.byteOffset, v1.byteOffset + v1.byteLength),
    [ ...path, '<arrayBuffer>' ]
  );
  
  if (inCls(v0, Error)) {
    // Include message, but not stack (because it's a nightmare to define expected stacktrace
    // values when defining expected results)
    return equal({ $msg: v0.message, ...v0 }, { $msg: v1.message, ...v1 }, [ ...path, '<obj>' ]);
  }
  
  return { equal: false, path, reason: 'unknown comparison', cls: getClsName(v0) };
  
};
export const assertEqual = (v0: any, v1: any) => {
  
  const { equal: eq, ...props } = equal(v0, v1);
  
  if (!eq) throw Error('assert equal')[mod]({ ...props });
  
};
export const testRunner = async (rawCases: { name: string, fn: () => Promise<void> }[]) => {
  
  const regStr = skip
    ?? process.argv.find(v => v.at(0) === '/' && v.at(-1) === '/')
    ?? '/(?:)/';
  const reg = new RegExp(regStr.slice('/'.length, -'/'.length));
  
  const cases = rawCases.filter(c => reg.test(c.name));
  const num = cases.length;
  const tot = rawCases.length;
  if (num === 0) { console.log('Nothing to test'); return; }
  
  console.log(`Launch ${num} test(${num === 1 ? '' : 's'})`);
  
  for (const { name, fn } of cases)
    try              { await fn(); }
    catch (err: any) { console.log(`FAILED: "${name}"`, err[limn]()); process.exit(1); }
  
  console.log(`Accept ${num} test(${num === 1 ? '' : 's'})`);
  if (num !== tot) console.log(`(Out of ${tot} total tests)`);
  
};