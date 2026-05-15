import { assertEqual, cmpJson, testRunner } from '../build/utils.test.ts';
import './main.ts';
import { LambdaAwsHttp, LambdaBase } from './main.ts';
import Logger from '@gershy/logger';
import { Fact, rootFact, tempFact } from '@gershy/disk';
import codecParse, { type Codec } from '@gershy/util-codec-parse';
import { Garden, Registry, Soil, type Context } from '@gershy/lilac';
import { getRootLogger } from '@gershy/entry';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import type { Jsfn } from '@gershy/util-jsfn-encode';

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

const args = eval(`(${ process.argv.find(v => v[0] === '{') ?? '{}' })`);

testRunner([
  
  { name: 'sourcecode gen', fn: async () => {
    
    const lbd = new LambdaAwsHttp({
      name: 'myLbd',
      memoryMb: 128,
      localData: { z: 'hi' },
      codec: { type: 'rec', props: {} },
      baseUrl: import.meta.url,
      launchFn: args => ({ code: 200, body: { desc: 'test', localData: args.localData } }),
      invokeFn: args => ({})[cl.merge](args.launchData)[cl.merge]({
        body: { req: args.args }
      }),
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
      if (term === '@gershy/clearing') return null;
      if (term === '@gershy/logger') return { default: function() { return Logger.dummy; } }; // Silence lambda logs
      if (term === '@gershy/util-codec-parse') return { default: codecParse };
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
    
    const res = await invoke({
      ctx: {
        callbackWaitsForEmptyEventLoop: false,
        clientContext:                  {},
        invokedFunctionArn:             'invoked-function-arn',
        awsRequestId:                   'aws-request-id',
        getRemainingTimeInMillis:       () => 1000 * 60 * 10
      },
      req: {
        path: '/test/path',
        httpMethod: 'GET',
        headers: {
          'User-Agent': 'its a test lmao',
          'cookie': 'k0=cookie0;k1=cookie1;'
        },
        multiValueHeaders: {
          'User-Agent': [ 'its a test lmao' ],
          'Cookie': [
            'k0=cookie0;k1=cookie1;',
            ';;;   ;  k2=cookie2   ; k4 = cookie444  ;;    ;',
            ';',
            ' =j  =  ',
            '   ;;;;;'
          ]
        },
        queryStringParameters: {
          'built.up.query.string': 'test',
        },
        multiValueQueryStringParameters: {
          'built.query.string': [ 'test' ],
        },
        requestContext: {
          identity: { sourceIp: '127.0.0.1' },
          stage:    'stage',
          domainName: 'test.local.com',
          resourceId: 'resource-id',
          stageVariables: {}
        },
        body: JSON.stringify({ its: [ 'my', { test: 'body' }, null, null, null, 100 ] })
      }
    });
    
    assertEqual(res, {
      headers: { 'content-type': 'application/json' },
      body: [ cmpJson, {
        desc: 'test',
        localData: { z: 'hi' },
        req: {
          path: [ 'test', 'path' ],
          method: 'get',
          headers: { 'user-agent': [ 'its a test lmao' ] },
          query: {
            built: { query: { string: 'test' } }
          },
          cookies: { k0: 'cookie0', k1: 'cookie1', k2: 'cookie2', k4: 'cookie444' },
          body: { its: [ 'my', { test: 'body' }, null, null, null, 100 ] }
        }
      }],
      isBase64Encoded: false,
      statusCode: 200
    });
    
  }},
  
  { name: 'garden growth', fn: () => isolated(async fact => {
    
    // Deploy the simplest possible api to localStack, and test if querying it works
    
    const { heavy = false } = args;
    if (!heavy) return void console.log('Skipping test');
    
    const logger = getRootLogger({ filter: ctx => true, lineWidth: 200 });
    logger.log({ $$: 'launch' });
    
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
      
      getGenericCodecFn() {
        
        return () => ({ type: 'rec', props: { body: { type: 'any' } } } as const);
        
      }
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
          
          return { desc: 'my lambda response', req: args.shapeData.req };
          
        };
        
      }
      
    };
    
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
        
        // TODO: Should every flower constructor take `ctx`? Then wouldn't have to pass it later...
        
        yield new registry.MyLambda({
          name: 'test',
          memoryMb: 1024,
          localData: {
            fn1: (a: string, b: number) => 'z'.repeat(b).split('').join(a)
          },
          codec: { type: 'rec', props: { body: {
            type: 'rec',
            props: { a: { type: 'str' }, b: { type: 'num' } }
          }}} as const,
          baseUrl: import.meta.url,
          launchFn: ctx => {
            
            return { fn2: (a: string, b: number) => ctx.localData.fn1(`(${a})`, b) };
            
          },
          invokeFn: ctx => {
            
            const { a, b } = ctx.args.body;
            return { result: ctx.launchData.fn2(a, b) };
            
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
      
      // const apis = await localStack.getApis();
      
      const lambda = new LambdaClient({
        region: 'ca-central-1',
        endpoint: process.env.LOCALSTACK_URL ?? 'http://127.0.0.1:4566',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
      });

      const listed = await lambda.send(new ListFunctionsCommand({}));
      const awsLbd = (listed.Functions ?? []).find(f => (f.FunctionName ?? '').includes('tezzzt'));
      console.log({ listed, awsLbd });
      
      // HEEERE2 INVOKE LAMBDA! Also getGitPending...
      
    } finally {
      
      logger.log({ $$: 'finish' });
      await soil.end();
      
    }
    
  })}
  
]);