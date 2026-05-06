// TODO: Flower definers (Lilac consumers) will want to use these - make sure they're well-exposed

export const embed = (v: string) => '${' + v + '}';
export const json = (v: Json) => [
  '| <<EOF',
  JSON.stringify(v, null, 2)[cl.indent](2),
  'EOF'
].join('\n');
