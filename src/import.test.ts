export class JsfnUtility {
  
  private a: string;
  constructor(args: { a: string }) {
    this.a = args.a;
  }
  helperFn(args: { b: number }) {
    return this.a.repeat(args.b);
  }
  toJsfn() {
    return { hoist: `${import.meta.dirname}::{JsfnUtility}` as const, form: this.constructor, args: [ { a: this.a } ] };
  }
  
};
