import '@gershy/clearing';
import { type Context, Flower, PetalTerraform, Soil } from '@gershy/lilac';
import Logger                                         from '@gershy/logger';
import { Network }                                    from '@gershy/lilac-network';
import slashEscape                                    from '@gershy/util-slash-escape';
import jsfnEncode, { type Jsfn, type JsImport }       from '@gershy/util-jsfn-encode';
import scriptBundle                                   from '@gershy/script-bundle';
import { rootFact }                                   from '@gershy/disk';
import JsZip                                          from 'jszip';
import hash                                           from '@gershy/util-hash';
import phrasing                                       from '@gershy/util-phrasing';
import type { Codec }                                 from '@gershy/util-codec-parse';
import * as aws                                       from './util/aws.ts';
import * as tf                                        from './util/terraform.ts';

type Role = Flower; // TODO: Solidify permissions?? Best practices - secrets, etc.

type LambdaShape = {
  
  // Represents the raw provider Lambda typing, with req+res and any additional context
  
  ctx: Obj<unknown>,
  req: unknown,
  res: unknown
  
};

export class LambdaBase<
  Shape extends LambdaShape,  // AWS and lambda i/o
  Res,                        // The lambda's particular response
  LocalData extends Jsfn,     // Data provided to lambda by project
  LaunchData,                 // Arbitrary data initialized by lambda on cold-start
  Cdc extends Codec.Rec<any>, // Codec for validating incoming invocation args
  Env extends Obj<string>     // Environment vars (main use-case is for passing arbitrary infra values to lambda)
> extends Flower {
  
  static awsNodeRuntime = 'nodejs22.x'; // TODO: higher versions may require the terraform provider to be updated?? And decouple from aws
  static importTs = (v: null | string, p: string) => v ? `import ${v} from '${p}';` : `import '${p}';`;
  static importJs = (v: null | string, p: string) => {
    if (!v) return `require('${p}');`;
    
    // Referencing the default import requires the "default" property to be dereferenced; this is
    // detected by checking if the 1st character of `v` is a letter, whereas non-default imports
    // use object notation (beginning with "{")
    return /^[a-zA-Z]/.test(v)
      ? `const { default: ${v} } = require('${p}');`
      : `const ${           v  } = require('${p}');`
  };
  
  private memoryMb:  number;
  private network:   null | Network;
  private name:      string;
  private localData: (() => Promise<LocalData>) | Promise<LocalData> | (() => LocalData) | LocalData;
  private codec:     Cdc;
  private baseUrl:   string;
  private launchFn:  (ctx: { debug: boolean, logger: Logger, jsfnImport: (fp: string) => any, localData: LocalData }) => LaunchData;
  private invokeFn:  (ctx: { debug: boolean, logger: Logger, jsfnImport: (fp: string) => any, raw: Pick<Shape, 'ctx' | 'req'>, launchData: LaunchData, args: Codec.Out<Cdc> }) => Res;
  private role:      Role;
  private env:       Env;
  
  constructor(args: {
    
    name:      string,
    memoryMb:  number,
    network?:  Network,
    localData: (() => Promise<LocalData>) | Promise<LocalData> | (() => LocalData) | LocalData;
    codec:     Cdc,
    baseUrl:   string,
    launchFn:  (ctx: { debug: boolean, logger: Logger, jsfnImport: (fp: string) => any, localData: LocalData }) => LaunchData,
    invokeFn:  (ctx: { debug: boolean, logger: Logger, jsfnImport: (fp: string) => any, raw: Pick<Shape, 'ctx' | 'req'>, launchData: LaunchData, args: Codec.Out<Cdc> }) => Res,
    role:      Role,
    env:       Env
    
  }) {
    
    if (!/^[a-zA-Z0-9]+$/.test(args.name)) throw Error('invalid name')[cl.mod]({ args });
    
    const memoryMb = args.memoryMb ?? 2048;
    if (memoryMb < 128 || memoryMb > 10240 || Math.floor(memoryMb) != memoryMb) throw Error('memory mb invalid')[cl.mod]({ memoryMb });
    
    super();
    
    this.memoryMb  = memoryMb;
    this.network   = args.network ?? null;
    this.name      = args.name;
    this.localData = args.localData;
    this.codec     = args.codec;
    this.baseUrl   = args.baseUrl;
    this.launchFn  = args.launchFn;
    this.invokeFn  = args.invokeFn;
    this.role      = args.role;
    this.env       = args.env;
    
  }
  
  public getName() { return this.name; }
  public getRole() { return this.role; }
  
  public * getDependencies() {
    yield* super.getDependencies();
    yield* this.role.getDependencies();
    if (this.network) yield* this.network.getDependencies();
  }
  
  public async getLocalData() {
    
    // Resolves our local data, which may have been provided in a function
    if (cl.inCls(this.localData, Function)) this.localData = this.localData();
    return this.localData as LocalData | Promise<LocalData>;
    
  }
  
  public getGenericCodecFn(): () => Codec.Rec<any> {
    
    throw Error('logic missing');
    
  }
  
  public getInvokeWrapper(): (args: {
    
    jsfnImport: (fp: string) => any,
    debug:      boolean,
    logger:     Logger,
    codec:      Cdc,
    launchData: LaunchData,
    shapeData:  Pick<Shape, 'ctx' | 'req'>,
    invokeFn:   LambdaBase<Shape, Res, LocalData, LaunchData, Cdc, Env>['invokeFn']
    
  }) => Promise<Shape['res']> {
    
    // Returns a sovereign function which:
    // - Takes all data relevant to a single invocation, represented by `args`
    // - Calls `args.invokeFn` with the appropriate data
    // - Returns a correctly-shaped response
    
    throw Error('logic missing');
    
  }
  
  public async getScript(args: { ctx: Context, lang: 'ts' | 'js' }) {
    
    // What are all possible places code can live? The space of urls. But sometimes code is
    // referred to by a pointer other than a url - the most common way is with a *relative path*; a
    // relative path is basically a url that requires context, and that context is: what is the
    // path relative to?? This question is answered by `(new Lambda(...)).baseUrl`, whose purpose
    // is to allow the meaningful conversion of relative paths to urls. Overall source code is
    // referenced by:
    // 1. A relative path - always begins with "."
    //    - `import './thing.ts'`
    //    - `import '../../thing.ts'`
    //    (relative path imports plus `baseUrl` can be resolved to a file:// url!)
    // 2. An npm import
    //    - `import 'zod'`
    //    - `import '@gershy/clearing'`
    // 3. A url (can't be confused with an npm import; disjoint based on presence of ":" character)
    //    - `import 'file:///C:/code/stuff.ts'`
    //    - `import 'https://scripts.org/cool-script.ts'`
    //    (Watch out for importing typescript in nodejs)
    
    // Converts this lambda's code (from multiple sources - launchFn, invokeFn, etc...) to a String
    // representing the entire aggregated lambda function definition, with imports to external
    // modules already embedded at the top of the code - can be used as sourcecode for webpack,
    // which will traverse any such imports.
    
    // Note the only use of typescript in the resulting lambda code at the moment is related to
    // imports (we get huge value leveraging typescript for imports because webpack's tree shaking
    // plus typescript `import` results in very minimal bundles!)
    // Compiling js vs ts is very simple; the logic to generate an import statement is the only
    // thing that varies depending on the language!
    
    const localData = jsfnEncode({ baseUrl: this.baseUrl, val: await this.getLocalData() });
    
    // Validate the vpc won't block access to any hoists!
    if (this.network) {
      
      const { jsImports } = localData;
      
      // TODO: This is very brittle - relies on the consumer using a particular naming scheme for
      // their js import variables - should at least convert to checking module names, i.e.
      // @gershy/lilac-bin-db, @gershy/lilac-doc-db, @gershy/lilac-email, @gershy/lilac-queue...
      // Consider: This is a "blacklist" approach - should really do a "whitelist" approach i.e.
      // every network boolean has a "permitsHoist" function, and every hoist needs to be permitted
      // by at least 1 boolean
      const vpcConfig = this.network.getConfig();
      const vpcInterferences = {
        binDb: { bool: vpcConfig.binDb, check: () => jsImports.filter(ji => /::LambdaStorage/.test(ji.varDef ?? '')) },
        docDb: { bool: vpcConfig.docDb, check: () => jsImports.filter(ji => /::LambdaDocDb/  .test(ji.varDef ?? '')) },
        email: { bool: vpcConfig.email, check: () => jsImports.filter(ji => /::LambdaEmail/  .test(ji.varDef ?? '')) },
        queue: { bool: vpcConfig.queue, check: () => jsImports.filter(ji => /::LambdaQueue/  .test(ji.varDef ?? '')) },
        w3:    { bool: vpcConfig.w3,    check: () => [ /* Impossible to verify for now... */ ]     },
      };
      
      for (const { bool, check } of vpcInterferences[cl.toArr](v => v)) {
        
        if (bool) continue;
        
        const blockedHoists = check();
        if (blockedHoists.length) throw Error('network hoist interference')[cl.mod]({ lambda: this.name, hoistsBlockedByVpc: blockedHoists });
        
      }
      
    }
    
    type InvokeWrapper = ReturnType<typeof this.getInvokeWrapper>;
    type LaunchFn = typeof this.launchFn;
    type InvokeFn = typeof this.invokeFn;
    type MainArgs = {
      jsfnImport:    <S extends string>(fp: S) => any, // import(S)
      name:          string,
      debug:         boolean,
      localData:     LocalData,
      invokeWrapper: InvokeWrapper,
      launchFn:      LaunchFn,
      codec:         Cdc,
      invokeFn:      InvokeFn
    };
    const code = {
      
      // Note how codec merging works - we want to allow the consumer to avoid defining codecs for
      // "generic" argument components, e.g. headers, cookies, but with the ability to expect
      // certain values from them if necessary, e.g. requiring a header in a specific format
      genericCodecFn: jsfnEncode({ baseUrl: this.baseUrl,    val: this.getGenericCodecFn() }),
      codec:          jsfnEncode({ baseUrl: this.baseUrl,    val: this.codec               }),
      launchFn:       jsfnEncode({ baseUrl: this.baseUrl,    val: this.launchFn            }),
      invokeFn:       jsfnEncode({ baseUrl: this.baseUrl,    val: this.invokeFn            }),
      invokeWrapper:  jsfnEncode({ baseUrl: import.meta.url, val: this.getInvokeWrapper()  }),
      getMainFn:      jsfnEncode({ baseUrl: import.meta.url, val: (args: MainArgs) => {
        
        const { default: Logger } = args.jsfnImport('@gershy/logger') as typeof import('@gershy/logger');
        
        const { jsfnImport, name, debug, localData, invokeWrapper, codec, launchFn, invokeFn } = args;
        
        const logger = new Logger('lambda');
        logger.log({ $$: 'launch', name });
        
        const launchData = logger.scope('supplies', {}, logger => launchFn({ debug, logger, jsfnImport, localData }));
        const invokeArgs = {
          debug,
          logger,
          launchData,
          jsfnImport,
          codec,
          invokeFn
        };
        return (shapeData: Pick<Shape, 'ctx' | 'req'>) => invokeWrapper({ ...invokeArgs, shapeData });
        
      }})
      
    } satisfies Obj<{ jsImports: JsImport[], code: string }>;
    
    const mergeJsImports = (jsImports: JsImport[]) => {
      
      // TODO: HEEEERE!
      // Note merging fails if:
      // - The same variable name is used by different importers to reference different values (no
      //   good name available for these global refs!)
      // 
      // Note some "apparent" failure cases can be accomodated:
      // - The same import reappearing, named differently - create aliases
      //      | 
      //      | import name1, { name2 } from 'module';
      //      | const name3 = name1;
      //      | const name4 = name2;
      //      | 
      
      const merged = {} as Obj<{ full: string[], named: Obj<string[]> }>;
      
      for (const ji of jsImports) {
        
        const varDef = ji.varDef?.trim() ?? null;
        const importPath = ji.importPath.trim();
        
        const imp = merged[importPath] ??= { full: [], named: {} };
        if (!varDef) continue;
        
        if (varDef[0] !== '{') { imp.full.push(varDef); continue; }
        
        for (const ent of varDef.slice(1, -1).split(',')) {
          const [ k, v = k ] = ent[cl.cut](':', 1);
          (imp.named[k] ??= []).push(v);
        }
        
      }
      
      return merged[cl.map](({ full, named }) => ({
        
        full: [ ...new Set(full) ],
        named: named[cl.map](ents => [ ...new Set(ents) ])
        
      }));
      
    };
    const getImports = (args: { mergedImports: ReturnType<typeof mergeJsImports>, lang: 'js' | 'ts' }) => {
      
      const imports: string[] = [];
      
      if (args.lang === 'js') {
        
        for (const [ importPath, { full, named } ] of args.mergedImports[cl.walk]()) {
          
          const hasFull = !full[cl.empty]();
          const hasNamed = !named[cl.empty]();
          
          if (!hasFull && !hasNamed) {
            imports.push(`require('${importPath}');`);
            continue;
          }
          
          if (hasFull) {
            
            const [ v, ...more ] = full;
            imports.push(...[
              `const ${v} = require('${importPath}');`,
              ...more.map(m => `const ${m} = ${v};`)
            ]);
            
          }
          
          if (hasNamed) {
            
            // Note `import { x as a, x as b, x as c } from './thingy.ts'` is legal typescript!
            // Note `const { x: a, x: b, x: c } = require('./thingy.ts')` is legal javascript!
            
            imports.push(`const { ${
              named
                [cl.toArr]((aliases, k) => aliases.map(a => a !== k ? `${k}: ${a}` : k))
                .flat(1)
            } } = require('${importPath}');`);
            
          }
          
        }
        
      } else if (args.lang === 'ts') {
        
        for (const [ importPath, { full, named } ] of args.mergedImports[cl.walk]()) {
          
          const hasFull = !full[cl.empty]();
          const hasNamed = !named[cl.empty]();
          
          
          if (!hasFull && !hasNamed) {
            imports.push(`import '${importPath}';`);
            continue;
          }
          
          if (hasFull) {
            
            const [ v, ...more ] = full;
            imports.push(...[
              `import ${v} from '${importPath}';`,
              ...more.map(m => `const ${m} = ${v};`)
            ]);
            
          }
          
          if (hasNamed) {
            
            // Note `import { x as a, x as b, x as c } from './thingy.ts'` is legal typescript!
            // Note `const { x: a, x: b, x: c } = require('./thingy.ts')` is legal javascript!
            
            imports.push(`import { ${
              named
                [cl.toArr]((aliases, k) => aliases.map(a => a !== k ? `${k} as ${a}` : k))
                .flat(1)
            } } from '${importPath}';`);
            
          }
          
        }
        
      }
      
      return imports;
      
    };
    
    return [
      
      ...getImports({
        mergedImports: mergeJsImports([
          { varDef: null, importPath: '@gershy/clearing' }, // Ensure clearing is imported
          ...code[cl.toArr](v => v.jsImports).flat(1)
        ]),
        lang: args.lang
      }),
      
      `const genericCodec = ${code.genericCodecFn.code};                                         `,
      `const codec = ${code.codec.code};                                                         `,
      `const fullCodec = (genericCodec())[cl.merge](cl.inCls(codec, Function) ? codec() : codec);`,
      `const localData = ${localData.code};                                                      `,
      `const launchFn = ${code.launchFn.code};                                                   `,
      `const invokeFn = ${code.invokeFn.code};                                                   `,
      `const invokeWrapper = ${code.invokeWrapper.code};                                         `,
      `const mainFn = (${code.getMainFn.code})({                                                 `,
      `  jsfnImport: jsImp => Error('jsfn import failed')[cl.fire]({ import: jsImp }),           `,
      `  name: '${slashEscape(this.name, `'`)}',                                                 `,
      `  debug: ${args.ctx.debug ? 'true' : 'false'},                                            `,
      `  codec: fullCodec, localData, invokeWrapper, launchFn, invokeFn                          `,
      `});                                                                                       `,
      
      {
        ts: 'export const handler = '   + `mainFn;`,
        js: 'module.exports.handler = ' + `mainFn;`
      }[args.lang]
      
    ].join('\n');
    
  }
  
  async getBundle(args: { ctx: Context, lang: 'ts' | 'js' }): Promise<{ script: string, packedCode: string, zippedCode: Buffer, hash: string }> {
    
    const script = await this.getScript(args);
    
    const resolvedName = `${args.ctx.pfx}-${this.name}`;
    
    const packedCode = await scriptBundle({
      debug: args.ctx.debug,
      platform: 'node/cjs',
      script,
      dirFact: rootFact.kid([ this.baseUrl ])
    });
    
    const zippedCode = await (async () => {
      const jsZip = new JsZip();
      jsZip.file(`${resolvedName}/code.js`, packedCode, { date: new Date(0) });
      return jsZip.generateAsync({ type: 'nodebuffer', compression: 'deflate'[cl.upper]() });
    })();
    
    // Note within the lambda's context there are 3 different options for the hash:
    // 1. Original typescript source code
    // 2. Compiled javascript code (webpacked, includes dependencies and sourceMapping)
    // 3. Overall zip file containing javascript code somewhere within it
    // The correct choice is the 3rd - for #1, changes to dependency code won't register as
    // changes (lambda will not be updated). For #2, changes to zip structure won't register,
    // e.g. adding a new file will not be captured. The only correct choice is #3!
    // Consider that `JsZip` produces buffers representing zipped files with nondeterministic
    // contents(!) causing hashes to change as code remains the same - using option #2 for now;
    // at present this is safe as the zip file contains nothing other than the single js file!
    
    
    return { script, packedCode, zippedCode, hash: await hash(packedCode) };
    
  } 
  async getPetals(ctx: Context & { soil: Soil.Base }) {
    
    const resolvedName = `${ctx.pfx}-${this.name}`;
    
    const { script, packedCode, zippedCode, hash } = await this.getBundle({ ctx, lang: 'js' });
    
    const { Resource, File } = PetalTerraform;
    const zipFile =        new File(`literal/lambda/${this.name}.js.zip`, zippedCode);
    const sourceCodeFile = new File(`literal/lambda/${this.name}.ts`,     script    ); // Consider removing; it's only for debug purposes
    const packedCodeFile = new File(`literal/lambda/${this.name}.js`,     packedCode); // Consider removing; it's only for debug purposes
    
    const roleTfEnt = await (async () => {
      
      for await (const petal of await this.role.getPetals(ctx))
        if (petal.getType() === 'awsIamRole')
          return petal;
      throw Error('role iam petal missing');
      
    })();
    
    const lambda = new Resource('awsLambdaFunction', this.name, {
      
      functionName: resolvedName,
      runtime:      LambdaBase.awsNodeRuntime,
      role:         roleTfEnt.ref('arn'),
      handler:      `${resolvedName}/code.handler`,
      filename:     zipFile.refStr(), // Should be a string in terraform
      timeout:      20,               // Seconds
      memorySize:   this.memoryMb,
      
      ...(this.network && await (async () => {
        
        const vpcEnts = await this.network!.getPetals(ctx);
        const subnets = vpcEnts.filter(v => v.getType() === 'awsSubnet');
        const securityGroup = vpcEnts.find(v => v.getType() === 'awsSecurityGroup')!;
        
        return {
          $vpcConfig: {
            subnetIds: subnets.map(sn => sn.ref('id')),
            securityGroupIds: [ securityGroup.ref('id') ]
          }
        };
        
      })()),
      
      sourceCodeHash: hash,
      
      $loggingConfig: {
        logFormat: 'json'[cl.upper]()
      },
      
      $environment: {
        variables: this.env ?? {}
      }
      
    });
    
    // Need to extend lambda iam permissions for vpc setup
    const policyTfEnts = (() => {
      
      const policyTfEnts: PetalTerraform.Base[] = []
      
      if (this.network) {
        
        const policy = new PetalTerraform.Resource('awsIamPolicy', `${this.name}VpcPolicy`, {
          name: `${ctx.pfx}-${this.name}Vpc`,
          policy: tf.json(aws.capitalKeys({ version: '2012-10-17', statement: [{
            effect: phrasing('camel->kamel', 'allow'),
            action: [
              'ec2:CreateNetworkInterface',
              'ec2:DescribeNetworkInterfaces',
              'ec2:DeleteNetworkInterface'
            ],
            resource: '*'
          }]}))
        });
        
        const attachment = new PetalTerraform.Resource('awsIamRolePolicyAttachment', `${this.name}VpcPolicy`, {
          role:      roleTfEnt.ref('name'),
          policyArn: policy.ref('arn')
        });
        
        policyTfEnts.push(policy, attachment);
        
      }
      
      return policyTfEnts;
      
    })();
    
    // Note there is no infrastructural link between a lamda and its log group - we can customize a
    // lambda's log group by simply defining a log group with the correct name the lambda will try
    // to log to!
    const logGroup = new PetalTerraform.Resource('awsCloudwatchLogGroup', this.name, {
      name:            `/aws/lambda/${tf.embed(lambda.ref('functionName'))}`,
      retentionInDays: 14
    });
    
    return [ zipFile, sourceCodeFile, packedCodeFile, lambda, logGroup, ...policyTfEnts ];
    
  }
  
}

type LambdaShapeAwsHttp = LambdaShape & {
  
  ctx: {
    callbackWaitsForEmptyEventLoop: boolean,
    clientContext: unknown,
    invokedFunctionArn: string,
    awsRequestId: string,
    getRemainingTimeInMillis: () => number
  },
  req: {
    path: string,
    httpMethod: string,
    
    // Consider: no headers currently; they're all filtered out by cloudfront!
    headers: Obj<string>,
    multiValueHeaders: Obj<string[]>,
    
    queryStringParameters: any,
    multiValueQueryStringParameters: Obj<string[]>,
    requestContext: {
      
      // The properties always show up:
      identity:   { sourceIp: `${number}.${number}.${number}.${number}` }, // Consider: typing is probably wrong for ipv6
      stage:      string,
      domainName: string,
      resourceId: `${'GET' | 'POST' | 'PUT'} /${string}`,
        
      // TODO: Websockets should be handled in a separate lambda subclass
      // // These show up for socket connections:
      // routeKey?:     '$connect' | '$disconnect' | string,
      // eventType?:    'CONNECT' | 'DISCONNECT' | string,
      // connectedAt?:  number,
      // connectionId?: string,
      
      stageVariables: Obj<string>
      
    },
    body: any, // Consider testing how this value looks? And is it coupled with "isBase64Encoded"??
    isBase64Encoded: boolean,
  },
  res: {
    statusCode: number,
    headers: { [K: string]: string | string[] },
    isBase64Encoded?: boolean
    body: Json,
  },
  
  invokeRes: { code: number, headers?: Obj<string> } & (
    | { base64?: false, body: Json }
    | { base64:  true,  body: string | ArrayBuffer }
  )
  
};
export class LambdaAwsHttp<
  LocalData extends Jsfn,                      // Data provided to lambda by project
  Res extends LambdaShapeAwsHttp['invokeRes'], // The lambda's particular response
  LaunchData,                                  // Arbitrary data initialized by lambda on cold-start
  Cdc extends Codec.Rec<any>,                  // Codec for validating incoming invocation args
  Env extends Obj<string>                      // Environment vars (main use-case is for passing arbitrary infra values to lambda)
> extends LambdaBase<LambdaShapeAwsHttp, Res, LocalData, LaunchData, Cdc, Env> {
  
  public getGenericCodecFn(): ReturnType<LambdaBase<any, any, any, any, any, any>['getGenericCodecFn']> {
    
    return () => {
      
      let builtStrsCodec: Codec.Map<any> = { type: 'map', item: { type: 'oneOf', opts: [ { type: 'str' } ] }};
      builtStrsCodec.item.opts.push(builtStrsCodec);
      return {
        type: 'rec',
        props: {
          path:    { type: 'arr',  item: { type: 'str' } },
          method:  { type: 'enum', opts: [ 'head', 'get', 'post', 'put', 'patch', 'delete' ] },
          headers: { type: 'map',  item: { type: 'arr', item: { type: 'str' } } },
          cookies: builtStrsCodec,
          query:   builtStrsCodec,
          body:    { type: 'any' }
        }
      };
      
    };
    
  }
  
  public getInvokeWrapper() {
    
    type LbdCls = typeof LambdaBase<LambdaShapeAwsHttp, any, any, any, any, any>;
    type LbdInvokeWrapper = ReturnType<InstanceType<LbdCls>['getInvokeWrapper']>;
    
    return (async (args: {
      
      jsfnImport: (fp: string) => any,
      debug:      boolean,
      logger:     Logger,
      codec:      Cdc,
      launchData: LaunchData,
      shapeData:  Pick<LambdaShapeAwsHttp, 'ctx' | 'req'>,
      invokeFn:   LambdaBase<LambdaShapeAwsHttp, Res, LocalData, LaunchData, Cdc, Env>['invokeFn']
      
    }) => {
      
      const { default: codecParse } = args.jsfnImport('@gershy/util-codec-parse') as typeof import('@gershy/util-codec-parse');
      
      const { isCls, skip } = cl;
      const mapk:  typeof cl.mapk  = cl.mapk;
      const lower: typeof cl.lower = cl.lower;
      const walk:  typeof cl.walk  = cl.walk;
      const at:    typeof cl.at    = cl.at;
      const map:   typeof cl.map   = cl.map;
      const toObj: typeof cl.toObj = cl.toObj;
      const cut:   typeof cl.cut   = cl.cut;
      const slash: typeof cl.slash = cl.slash;
      const limn:  typeof cl.limn  = cl.limn;
      const merge: typeof cl.merge = cl.merge;
      
      // linear
      // nested
      
      const ms = Date.now();
      const { jsfnImport, debug, codec, launchData, shapeData, invokeFn } = args;
      const { ctx, req } = shapeData;
      const logger = args.logger.kid('invoke');
      
      const { code, headers = {}, body, base64 = false } = await (async (): Promise<Res> => {
        
        const headers: Obj<string[]> = (req.multiValueHeaders ?? {})[mapk]((v, k) => [ k[lower](), v ]);
        
        const reqBody = (() => {
          if (!req.body) return null;
          try { return JSON.parse(req.body); } catch(err) {}
          return req.body;
        })();
        
        const build = <O extends Obj<any>>(obj: O) => {
          
          // Convert:
          //    | {
          //    |   'a.b.c': 1,
          //    |   'a.x.y': 2
          //    | }
          // To:
          //    | { a: { b: { c: 1 }, x: { y: 2 } } }
          
          type Built<T> = T | { [K: string]: Built<T> };
          const result: Built<O> = {};
          for (const [ k, v ] of obj[walk]()) {
            
            const dive = k.split('.');
            const last = dive.pop()!;
            let ptr = result;
            for (const cmp of dive) ptr = ptr[at](cmp) ?? (ptr[cmp] = {});
            ptr[last] = isCls(v, Object) ? build(v) : v;
            
          }
          
          return result;
          
        };
        
        const args = {
          
          path: req.path.split('/').filter(v => !!v.trim()),
          method: req.httpMethod[lower](),
          headers: headers[slash]([ 'cookie' ]),
          
          // Note we do not accept multi-value query strings; we ignore any duplicated name beyond
          // the first. To provide an array in a query use e.g. `val.0=a&val.1=b&val.2=c`
          query: build(
            (req.multiValueQueryStringParameters ?? {})
              [map](v => v[0])
          ),
          
          cookies: build(
            (headers.cookie ?? [])
              [map](cookies => cookies.split(/[;][ ]*/))
              .flat(1)
              [toObj](c => {
                const [ k, v ] = c[cut]('=', 1)[map](v => v.trim());
                if (!k || !v) return skip;
                return [ k, v ] as const;
              })
          ),
          
          body: reqBody
          
        };
        
        const dbgArgs = args[slash]([ 'headers' ]);
        
        try {
          
          logger.log({ $$: 'launch', debug, args: dbgArgs });
          
          const parsedArgs = codecParse(codec, args);
          
          const res = await invokeFn({ debug, logger, jsfnImport, raw: { ctx, req }, launchData, args: parsedArgs });
          logger.log({ $$: 'accept', ms: Date.now() - ms, res });
          return res;
          
        } catch(err: any) {
          
          if (err.codecParse) err.http = {
            body: {
              desc: 'input rejected',
              args: err.args ?? null,
              chain: err.chain ?? [],
              guard: (err.fn ?? (args => false)).toString().replace(/\s+/g, ' ')
            }
          };
          
          if (err.http) {
            
            // The error representation appears in two places:
            // 1. In logs
            // 2. In the http response, if in "debug" mode
            // In both cases, it's accompanied with the full http response value - since the full
            // http response value is a superset of the error's "http" property, we don't have to
            // include the "http" value in either case!
            const { http = {}, ...errLimn } = err[limn]();
            const res: Res = { code: 400, base64: false, body: { code: 'reject', trace: logger.getTraceId('invoke') } }
              [merge](http as {})
              [merge](debug ? { body: { err: errLimn } } : {}) as any;
            
            // In debug mode, don't log res.body.err - it's already available in the log as "err"
            logger.log({ $$: 'reject', ms: Date.now() - ms, err: errLimn, res: debug ? {}[merge](res)[merge]({ body: { err: skip } }) : res });
            return res;
            
          } else {
            
            const res: Res = { code: 500, body: { code: 'glitch', trace: logger.getTraceId('invoke') } }
              [merge](debug ? { body: { err: err[limn]() } } : {}) as any;
            
            logger.log({ $$: 'glitch', ms: Date.now() - ms, err, res });
            return res;
            
          }
          
        }
        
      })();
      
      const isStringBody = isCls(body, String);
      const hdrs = { contentType: isStringBody ? 'text/plain' : 'application/json', ...headers };
      return {
        statusCode: code,
        headers: hdrs[mapk]((v, k) => [ k.replace(/([A-Z])/g, '-$1')[lower](), v ]), // Kebab-case!
        body: isStringBody ? body : JSON.stringify(body), // TODO: Allow response body to be `skip` (to provide websockets with a way to send *no* response as opposed to `null` response)
        isBase64Encoded: base64
      };
      
    }) satisfies LbdInvokeWrapper;
    
  }
  
}

// TODO: Websockets, L@E, petals, webpack, zip, test lambdas in localstack!