import { assertEqual, cmpAny, testRunner, cmpReg } from '../build/utils.test.ts';
import './main.ts';
import { LambdaBase } from './main.ts';
import Logger from '@gershy/logger';
import { Fact, rootFact, tempFact } from '@gershy/disk';
import codecParse, { type Codec } from '@gershy/util-codec-parse';
import { Garden, Registry, Soil, type Context } from '@gershy/lilac';
import { getRootLogger } from '@gershy/entry';
import { InvokeCommand, LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import type { Jsfn } from '@gershy/util-jsfn-encode';
import { JsfnUtility } from './import.test.ts';

// Type testing
(async () => {
  
  type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
  
  type Tests = {
    1: Enforce<{ x: 'y' }, { x: 'y' }>,
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

const isolated = async (fn: (fact: Fact) => Promise<void>) => {
  
  let fact: null | Fact = null;
  try {
    
    fact = await rootFact.kid([ import.meta.dirname, '.isolatedTest' ], { newTx: true });
    await fn(fact);
    
  } finally {
    
    await fact?.rem();
    fact?.tx.end();
    
  }
  
};
const getSubtree = async (ent: Fact, enc: 'bin' | 'str' | 'json') => {
  
  // Consider - `terraform init` might be quite slow... should it be in these tests??
  const [ data, kids ] = await Promise.all([
    
    ent.getData(enc as any),
    await ent.getKids()
      .then(kids => Promise[cl.allObj](kids[cl.map](kid => getSubtree(kid, enc))))
    
  ]);
  
  return { data, kids };
  
};

const logger = getRootLogger({ name: 'test', filter: ctx => true, maxLineLen: 150, maxStrLen: 1000, objDepth: 7 });
const args = eval(`(${ process.argv.find(v => v[0] === '{') ?? '{}' })`);

const { MyLambda } = (() => {
  
  type MyLambdaShape = {
    ctx: Obj<unknown>,
    req: Json,
    res: Json
  };
  class MyLambda<
    Res,
    LocalData extends { [K: string]: Jsfn },
    LaunchData,
    Cdc extends Codec.Rec<any>,
    Env extends Obj<string>
  > extends LambdaBase<MyLambdaShape, Res, LocalData, LaunchData, Cdc, Env> {
    
    getInvokeWrapper() {
      
      return async (args: {
        jsfnImport: (fp: string) => any,
        debug:      boolean,
        logger:     Logger,
        codec:      Cdc,
        launchData: LaunchData,
        shapeData:  Pick<MyLambdaShape, 'ctx' | 'req'>,
        invokeFn:   LambdaBase<MyLambdaShape, Res, LocalData, LaunchData, Cdc, Env>['invokeFn']
      }) => {
        
        const { default: codecParse } = args.jsfnImport('@gershy/util-codec-parse') as typeof import('@gershy/util-codec-parse');
        
        const invokeArgs = (() => {
          
          try {
            
            const nativeCodec = { type: 'rec', props: { a: { type: 'str' }, b: { type: 'num' } }, loose: true } as const;
            const lambdaReq = codecParse(nativeCodec, args.shapeData.req);
            const instanceReq = codecParse(args.codec, lambdaReq);
            return {
              success: true as const,
              result: instanceReq
            };
            
          } catch (err: any) {
            
            return {
              success: false as const,
              overview: {
                desc: 'input reject',
                err: err[cl.limn](),
                args: err.args ?? null,
                chain: err.chain ?? [],
                guard: (err.fn ?? (args => false)).toString().replace(/\s+/g, ' ')
              }
            };
            
          }
          
        })();
        
        if (!invokeArgs.success) return {
          desc: 'my lambda failed, very sad',
          ctx: args.shapeData.ctx as any,
          req: args.shapeData.req,
          res: invokeArgs.overview
        };
        
        return {
          desc: 'my lambda success',
          ctx: args.shapeData.ctx as any,
          req: args.shapeData.req,
          res: args.invokeFn({
            ...args[cl.slice]([ 'debug', 'logger', 'jsfnImport', 'launchData', 'shapeData' ]),
            args: invokeArgs.result
          }) as Json
        };
        
      };
      
    }
    
  };
  
  return { MyLambda };
  
})();

testRunner([
  
  { name: 'sourcecode gen', fn: async () => {
    
    // Instantiates a `JsfnUtility` instance with `a = 'util'`, and takes an http body param `b`,
    // which is a number, to call `JsfnUtility.prototype.helperFn`, which returns `a.repeat(b)`
    
    const lbd = new MyLambda({
      name: 'myLbd',
      baseUrl: import.meta.url,
      memoryMb: 128,
      localData: {
        z: 'hi',
        utility: new JsfnUtility({ a: 'util' })
      },
      codec: { type: 'rec' as const, props: { num: { type: 'num' as const } }, loose: true },
      launchFn: args => ({ utility: args.localData.utility }),
      invokeFn: ({ launchData, args }) => launchData.utility.helperFn({ b: args.num }),
      env: {}
    });
    
    const script = await lbd.getScript({
      ctx: {
        name:      'test',
        logger:    new Logger('test'),
        fact:      rootFact.kid([ import.meta.dirname, 'infra' ]),
        patioFact: rootFact.kid([ import.meta.dirname, 'infra', 'patio' ]),
        shedFact:  tempFact.kid([ '@gershy' ]),
        maturity: 'm0',
        debug: true,
        pfx: 'test'
      },
      lang: 'js'
    });
    
    let builtStrsCodec: Codec.Map<any> = { type: 'map', item: {
      type: 'oneOf',
      opts: [
        { type: 'str' },
        // { type: 'map', item: {
        //   type: 'oneOf',
        //   opts: [
        //     { type: 'str' },
        //     { type: 'map', item: { type: 'str' }}
        //   ]
        // }}
      ]
    }};
    builtStrsCodec.item.opts.push(builtStrsCodec);
    
    const require = (term: string) => {
      if (term === '@gershy/clearing') return null;                                           // Clearing not necessary - already loaded!
      if (term === '@gershy/logger') return { default: function() { return Logger.dummy; } }; // Silence lambda logs
      if (term === '@gershy/util-codec-parse') return { default: codecParse };                // Pass our codec parsing lib
      throw Error('mock require unaware')[cl.mod]({ term });
    };
    const invoke = eval(String[cl.baseline](`
      | (({ require }) => {
      |   
      |   const module = { exports: {} };
      |   
      ${script[cl.indent]('|   ')}
      |   
      |   return module.exports.handler;
      |   
      | })
    `))({ require });
    
    const res = await invoke({ a: 'ignored', b: 'also ignored'.length, num: 4 }, { desc: 'ctx!' });
    
    assertEqual(
      res,
      {
        desc: 'my lambda success',
        ctx: { desc: 'ctx!' },
        req: { a: 'ignored', b: 12, num: 4 },
        res: 'utilutilutilutil'
      }
    );
    
  }},
  
  { name: 'garden growth', fn: () => isolated(async fact => {
    
    // Deploy the simplest possible api to localStack, and test if querying it works
    
    const { heavy = false } = args;
    if (!heavy) return void console.log('Skipping test');
    
    logger.log({ $$: 'launch' });
    
    const registry = new Registry({
      MyLambda: { real: MyLambda, test: MyLambda }
    });
    
    const shedFact = tempFact.kid([ '@gershy' ]);
    const patioFact = fact.kid([ 'repo', 'patio' ]);
    const gardenFact = fact.kid([ 'repo', 'terraform' ]);
    const context: Context = {
      name: 'hi',
      fact: gardenFact,
      patioFact,
      shedFact,
      logger: logger.kid('garden'),
      maturity: 'm0',
      debug: false,
      pfx: 'tezzzt',
    };
    
    const garden = new Garden({
      context,
      registry,
      define: function*(ctx, registry) {
        
        yield new registry.MyLambda({
          name: 'test',
          memoryMb: 1024,
          localData: {
            fn1: (a: string, b: number) => 'z'.repeat(b).split('').join(a)
          },
          codec: { type: 'rec', props: { a: { type: 'str' }, b: { type: 'num' } } } as const,
          baseUrl: import.meta.url,
          launchFn: ctx => {
            return { fn2: (a: string, b: number) => ctx.localData.fn1(`(${a})`, b) };
          },
          invokeFn: ctx => {
            
            const { a, b } = ctx.args;
            return ctx.launchData.fn2(a, b);
            
            // Not an http response - can be either Json or binary response - TODO: think about how
            // the typing can tighten the response! Currently it can be `any`...
            
          },
          env: {}
        });
        
      }
    });
    
    const soil = new Soil.LocalStack({ logger, aws: { region: 'ca-central-1' }, registry });
    const localStack = await soil.run();
    void localStack;
    
    try {
      
      // TODO: real/fake -> natural/plastic
      await garden.grow({ type: 'real', soil });
      
      const lambdaClient = new LambdaClient({
        region: 'ca-central-1',
        endpoint: process.env.LOCALSTACK_URL ?? 'http://127.0.0.1:4566',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
      });
      const awsLbd = await lambdaClient.send(new ListFunctionsCommand({}))
        .then(listed => (listed.Functions ?? []).find(f => (f.FunctionName ?? '').includes('tezzzt')));
      if (!awsLbd) throw Error('lambda missing');
      
      const invoke = async (args: any) => {
        
        const invoked = await lambdaClient.send(new InvokeCommand({
          FunctionName: awsLbd.FunctionName,
          Payload: Buffer.from(JSON.stringify(args))
        }));
        const result = JSON.parse(invoked.Payload!.transformToString('utf8'));
        
        // logger.log({ inp: args, out: result });
        
        return result;
        
      };
      
      const assertCtx = {
        callbackWaitsForEmptyEventLoop: true,
        functionVersion: '$LATEST',
        functionName: 'tezzzt-test',
        memoryLimitInMB: '1024',
        awsRequestId: cmpAny,
        logGroupName: cmpAny,
        logStreamName: [ cmpReg, /^[0-9]{4}[/][0-9]{2}[/][0-9]{2}/ ],
        invokedFunctionArn: [ cmpReg, /^arn:aws:lambda:ca-central-1:[0-9]{12}:function:tezzzt-test/ ],
      };
      
      assertEqual(
        await invoke({ a: 'x', b: 3 }),
        {
          desc: 'my lambda success',
          ctx: assertCtx,
          req: { a: 'x', b: 3 },
          res: 'z(x)z(x)z'
        }
      );
      
      assertEqual(
        await invoke({ a: 3, b: 'x' }),
        {
          desc: 'my lambda failed, very sad',
          ctx: assertCtx,
          req: { a: 3, b: 'x' },
          res: {
            desc: 'input reject',
            args: { val: 3, minLen: 0, maxLen: 18446744073709552000 },
            chain: [ 'a' ],
            guard: cmpAny
          }
        }
      );
      
    } finally {
      
      logger.log({ $$: 'finish' });
      await soil.end();
      
    }
    
  })}

]);

/*
shaina loves you very much like so much 

that

she cant really even

quite express

HOW 

much!!!




its wild.







p.s clumpus loves u too
*/