// Offline opt-in helper. No public route may create or reset an account.
import {Accounts} from '../accounts.mjs';
import {createTester} from '../demo-account.mjs';
import {resolve} from 'node:path';
if(process.argv.length!==3||process.argv[2]!=='--create')throw Error('Usage: node tools/provision-demo.mjs --create');
const a=new Accounts(resolve(process.env.FINGUARD_DATA_DIR||'.data'));
try{console.log(JSON.stringify({...createTester(a.db),simulationOnly:true}));}finally{a.close();}
