import readline from 'node:readline';

/** Ask a question on the TTY; when hidden, typed characters are not echoed. */
export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

export async function masterPassword({ confirm = false } = {}) {
  if (process.env.FINREPORT_PASSWORD) return process.env.FINREPORT_PASSWORD;
  const p = await ask('Master password: ', { hidden: true });
  if (!p) throw new Error('A master password is required.');
  if (confirm) {
    const p2 = await ask('Repeat master password: ', { hidden: true });
    if (p !== p2) throw new Error('Passwords do not match.');
  }
  return p;
}
