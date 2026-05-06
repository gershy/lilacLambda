import '@gershy/clearing';

const { isCls, getClsName } = clearing;

const normalize = (val: any, seen = new Set<any>()) => {
  
  // Derives a json-stringifiable value from *any* value
  // E.g. to hash *anything*: hash(JSON.stringify(normalized(anything)));
  
  // Handles terminations
  if (isCls(val, String)) return val;
  if (isCls(val, Number)) return val;
  if (val === null)       return null;
  if (val === undefined)  return null;
  
  if (seen.has(val)) return '<<!circ!>>';
  seen.add(val);
  
  if (isCls(val, Array)) return val[cl.map](v => normalize(v, seen));
  if (isCls(val, Object)) return normalize(Object.entries(val).sort((e0, e1) => e0[0] < e1[0] ? -1 : 1), seen);
  
  return normalize({ $form: getClsName(val), ...val }, seen);
  
};
export default normalize;