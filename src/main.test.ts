import { assertEqual, cmpAny, testRunner, cmpReg } from '../build/utils.test.ts';
import './main.ts';
import { LambdaBase } from './main.ts';
import Logger from '@gershy/logger';
import { Fact, rootFact, tempFact } from '@gershy/disk';
import codecParse, { type Codec } from '@gershy/util-codec-parse';
import { Garden, SeedBank, Soil } from '@gershy/lilac';
import { InvokeCommand, LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import type { Jsfn } from '@gershy/util-jsfn-encode';
import { JsfnUtility } from './import.test.ts';
import { entry } from '@gershy/entry';

const codec = { type: 'rec', props: {
  reg:    { type: 'str', map: (str: string) => new RegExp(str) },
  effort: { type: 'enum', opts: [ 0, 1, 2, 3, 4, 5, 6 ] }
}} as const;

entry({ name: 'lilacLambda', codec, inp: { reg: '^', effort: 0 }, fn: async (logger, { reg, effort, ...inp }) => {
  
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
      
      fact = await rootFact.kid([ import.meta.dirname, '.isolated' ], { newTx: true });
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
              
              const nativeCodec = { type: 'rec', loose: true, props: { a: { type: 'str' }, b: { type: 'num' } } } as const;
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

  await testRunner({ logger, reg, effort, inp, cases: [
    
    { name: 'sourcecode gen', fn: async () => {
      
      // Instantiates a `JsfnUtility` instance with `a = 'util'`, and takes an http body param `b`,
      // which is a number, to call `JsfnUtility.prototype.helperFn`, which returns `a.repeat(b)`
      
      const lbd = new MyLambda({
        garden: { defaults: { region: 'ca-central-1' } } as any,
        name: 'myLbd',
        baseUrl: import.meta.url,
        memoryMb: 128,
        localData: {
          z: 'hi',
          utility: new JsfnUtility({ a: 'util' })
        },
        codec: { type: 'rec', loose: true, props: { num: { type: 'num' } } } as const,
        launchFn: args => ({ utility: args.localData.utility }),
        invokeFn: ({ launchData, args }) => launchData.utility.helperFn({ b: args.num }),
        env: {}
      });
      
      const script = await lbd.getScript({ lang: 'js' });
      
      const require = (term: string) => {
        if (term === '@gershy/clearing') return null;                                           // Clearing not necessary - already loaded!
        if (term === '@gershy/logger') return { default: function() { return Logger.dummy; } }; // Silence lambda logs
        if (term === '@gershy/util-codec-parse') return { default: codecParse };                // Pass our codec parsing lib
        if (term.split(/[/\\]/).slice(-2).join('/') === 'src/import.test.ts') return { JsfnUtility };
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
    
    { name: 'garden growth', effort: 2, fn: () => isolated(async fact => {
      
      // Deploy the simplest possible api to localStack, and test if querying it works
      // TODO: Forget localstack, test should work against real aws
      
      logger.log({ $$: 'launch' });
      
      const seedBank = new SeedBank({
        MyLambda: { real: MyLambda, test: MyLambda }
      });
      
      const garden = new Garden({
        term: 'hi',
        infraFact: fact.kid([ 'repo', 'terraform' ]),
        patioFact: tempFact.kid([ '@gershy' ]),
        shedFact: fact.kid([ 'repo', 'patio' ]),
        logger,
        debug: false,
        pfx: 'lilaclambdatest',
        seedBank,
        survey: (garden, seedBank, add) => {
          
          add(new seedBank.MyLambda({
            name: 'test',
            localData: {
              fn1: (a: string, b: number) => 'z'.repeat(b).split('').join(a)
            },
            codec: { type: 'rec', props: { a: { type: 'str' }, b: { type: 'num' } } } as const,
            baseUrl: import.meta.url,
            launchFn: ctx => ({ fn2: (a: string, b: number) => ctx.localData.fn1(`(${a})`, b) }),
            // Not an http response - can be either Json or binary response
            invokeFn: ctx => ctx.launchData.fn2(ctx.args.a, ctx.args.b),
            env: {}
          }));
          
        }
      });
      
      const soil = new Soil.LocalStack({ logger, garden });
      const localStack = await soil.run();
      void localStack;
      
      try {
        
        // TODO: real/fake -> natural/plastic
        await garden.grow({ type: 'real', soil });
        
        const lambdaClient = new LambdaClient({
          region: 'ca-central-1',
          endpoint: process.env.LOCALSTACK_URL ?? 'http://127.0.0.1:4566' // TODO: Why is env var used??
          // credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
        });
        const awsLbd = await lambdaClient.send(new ListFunctionsCommand({}))
          .then(listed => (listed.Functions ?? []).find(f => (f.FunctionName ?? '').includes('lilaclambdatest')));
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
          functionName: 'lilaclambdatest-test',
          memoryLimitInMB: '128',
          awsRequestId: cmpAny,
          logGroupName: cmpAny,
          logStreamName: [ cmpReg, /^[0-9]{4}[/][0-9]{2}[/][0-9]{2}/ ],
          invokedFunctionArn: [ cmpReg, /^arn:aws:lambda:ca-central-1:[0-9]{12}:function:lilaclambdatest-test/ ],
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

  ]});
  
}});

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