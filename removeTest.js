/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var async = require('async');
var ueberDB = require("./CloneAndAtomicLayer");
var log4js = require('log4js');
var assert = require('assert');
var util = require("util");

var test_settings = require("./defaultTestSettings.js");
var db = null;

// Validate parameters
if(process.argv.length == 3)
{
  var settings = test_settings[process.argv[2]];
}
else
{
  console.error("Invalid parameters");
  process.exit(1);
}


async.series(
  [

    // initialize the database
    function(callback)
    {
      console.log("initializing database");
      db = new ueberDB.database(process.argv[2], settings, null, log4js.getLogger("ueberDB"));
      db.init(callback);
    },

    // ensure keys that are added are properly deleted after
    function(callback)
    {
      console.log("executing test");
      console.log("Setting: test_remove = test_remove");

      // set a value
      db.db.wrappedDB.set("test_remove", "test_remove", function(err)
      {
        assert.ok(!err);

        // ensure it is there
        db.db.wrappedDB.get("test_remove", function(err, value)
        {
          assert.ok(!err);
          assert.strictEqual(value, "test_remove");

          console.log("Set was successful");
          console.log("Removing: test_remove");

          // remove it
          db.db.wrappedDB.remove("test_remove", function(err)
          {
            assert.ok(!err);

            // ensure it is no longer there
            db.db.wrappedDB.get("test_remove", function(err, value)
            {
              assert.ok(!err);
              assert.strictEqual(value, null);

              console.log("Remove was successful");

              callback();
            });
          });
        });
      });
    }
  ],
  function(err) {
    assert.ok(!err);
    console.log("Test complete");
    process.exit(0);
  }
);