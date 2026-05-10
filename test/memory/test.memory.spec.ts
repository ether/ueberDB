import wtfnode from 'wtfnode';
import {after, describe} from 'node:test'
import {test_db} from "../lib/test_lib.ts";


// eslint-disable-next-line mocha/no-top-level-hooks
after(async () => {
  // Add a timeout to forcibly exit if something is keeping node from exiting cleanly.
  // The timeout is unref()ed so that it doesn't prevent node from exiting when done.
  setTimeout(() => {
    console.error('node should have exited by now but something is keeping it open ' +
            'such as an open connection or active timer');
    wtfnode.dump();
    process.exit(1); // eslint-disable-line n/no-process-exit
  }, 5000).unref();
});

describe('sqlite test', ()=>{
  test_db('memory')
})
