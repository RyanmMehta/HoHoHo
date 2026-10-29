import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {writeFileSync,chmodSync} from 'node:fs';
process.stdout.write('Enter the admin password (hidden), then Return: ');
process.stdin.setRawMode(true);process.stdin.resume();let value='';
process.stdin.on('data',chunk=>{for(const c of chunk.toString()){if(c==='\u0003')process.exit(1);if(c==='\r'||c==='\n'){const salt=randomBytes(16);const digest=pbkdf2Sync(value,salt,100000,32,'sha256').toString('hex');const path=new URL('../.dev.vars',import.meta.url);writeFileSync(path,`ADMIN_PASSWORD_HASH=${salt.toString('hex')}:${digest}\n`,{mode:0o600});chmodSync(path,0o600);process.stdout.write('\nPassword hash configured locally.\n');process.exit(0)}else if(c==='\u007f')value=value.slice(0,-1);else value+=c}});
