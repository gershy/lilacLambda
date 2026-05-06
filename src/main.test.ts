import { assertEqual, cmpJson, testRunner } from '../build/utils.test.ts';
import './main.ts';
import { LambdaAwsHttp, LambdaBase } from './main.ts';
import Logger from '@gershy/logger';
import { Fact, rootFact, tempFact } from '@gershy/disk';
import codecParse, { type Codec } from '@gershy/util-codec-parse';
import { Registry } from '@gershy/lilac';

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
      role: null as any,
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
    
    // TODO: HEEERE1 provision localStack lambda, invoke it simply with aws lambda client (it's a
    // generic, non-http lambda!)
    const registry = new Registry({
      Lambda: { real: LambdaBase, test: LambdaBase }
    });
    
    if (0) console.log(registry);
    
  })}
  
]);