import type { Fact } from '@gershy/disk';
import proc, { type ProcOpts } from '@gershy/nodejs-proc';

export type ProcTerraformArgs = ProcOpts & { config?: string };
export default (fact: Fact, cmd: string, opts: ProcTerraformArgs = {}) => {
  
  const numTailingTfLogLines = 20;
  
  const writeLog = async (result: string | Obj<Json> | Json[]) => {
    const [ yr, mo, dy, hr, mn, sc, _ms ] = new Date().toISOString().match(/([0-9]{4})[-]([0-9]{2})[-]([0-9]{2})[T]([0-9]{2})[:]([0-9]{2})[:]([0-9]{2})[.]([0-9]+)[Z]/)!.slice(1);
    const term = `${cmd.split(' ')[1]}-${yr}${mo}${dy}-${hr}${mn}${sc}`;
    const logDb = fact.kid([ '.terraform.log', `${term}.txt` ]);
    await logDb.setData(result);
    return logDb;
  };
  
  const prm = proc(cmd, {
    timeoutMs: 0,
    ...opts,
    cwd: fact,
    env: {
      ...process.env,
      TF_DATA_DIR: '',
      TF_CLI_CONFIG_FILE: '',
      ...opts.env
    }
  });
  
  return Object.assign(prm.then(
    async result => {
      const logDb = await writeLog(result.output);
      return { logDb, output: result.output.split('\n').slice(-numTailingTfLogLines).join('\n') };
    },
    async err => {
      const logDb = await writeLog(err.output ?? err[cl.limn]());
      throw Error(`terraform failed (${err.message})`)[cl.mod]({
        logDb,
        ...(err.output ? { output: err.output.split('\n').slice(-numTailingTfLogLines).join('\n') } : { cause: err })
      });
    }
  ), { proc: prm.proc });
  
};