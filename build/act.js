import fs from 'node:fs/promises';
import path from 'node:path';

(async () => {
  
  const dir = path.join(import.meta.dirname, '..');
  const mode = process.argv.at(-1);
  
  const ops = {
    
    // Completely remove the "cmp" directory
    removeCmp: async () => {
      
      await fs.rm(path.join(dir, 'cmp'), { recursive: true, force: true });
      
    },
    
    // Run after compilation - applies changes to each code variant (e.g. cjs, mjs)
    finalizeExportVariants: async () => {
      
      await Promise.all([
        
        // Copy side effect typing into the cmp files
        fs.cp(
          path.join(dir, 'src', 'sideEffects.d.ts'),
          path.join(dir, 'cmp', 'sideEffects.d.ts')
        ),
        
        ...[
          { fd: 'mjs', pkg: { type: 'module' } },
          { fd: 'cjs', pkg: { type: 'commonjs' } }
        ].map(async def => {
          
          // TODO: Note that the .d.ts files for mjs and cjs are duplicated - the tsc compilation
          // for both uses { "emitDeclaration": true }! How to minimize the amount of stuff in the
          // npm bundle?? Especially when there are multiple .js/.d.ts file associations??
          
          const { fd, pkg } = def;
          
          const cmpFp = path.join(dir, 'cmp', fd);
          const mainTypingFp = path.join(cmpFp, 'main.d.ts');
          
          await Promise.all([
            
            // Write a nested package.json
            fs.writeFile(path.join(cmpFp, 'package.json'), JSON.stringify(pkg)),
            
            // Rewrite main.d.ts so that it imports the side effects
            (async () => {
              
              const mainTypingData = await fs.readFile(mainTypingFp, 'utf8');
              await fs.writeFile(mainTypingFp, `import '../sideEffects.js';\n${mainTypingData}`);
              
            })(),
            
          ]);
          
        })
        
      ]);
      
    }
    
  };
  
  if (!{}.hasOwnProperty.call(ops, mode)) {
    
    console.log('Unsupported option', process.argv);
    process.exit(1);
    
  } else {
    
    await ops[mode]();
    
  }
  
  
})().catch(err => {
  console.log('fatal', err);
  process.exit(1);
});
