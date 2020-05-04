var config = require('./config');
  path = require('path'),
  fs = require('fs'),
  etherdb = require(config.LIB_ETHERDB),
  events = require('events'),
  assert = require('assert');

var exists = fs.exists;

function etherdbAPITests(file) {
  describe('etherdb api', function() {
    function cleanup(done) {
      exists(file, function(doesExist) {
        if (doesExist) {
          fs.unlinkSync(file);
        }

        done();
      });
    }

    before(cleanup);

    describe('etherdb constructor', function() {
      //var db = etherdb(file);
      var db = new etherdb.database("dirty", {"filename": exports.TMP_PATH });
//      db.init(function(){
//        after(cleanup);

/*
        it('is an event emitter', function() {
          assert.ok(db instanceof events.EventEmitter);
        });

        it('is a etherdb', function() {
          assert.ok(db instanceof etherdb);
        });
*/
//      })

    });


    describe('events', function() {

      afterEach(cleanup);


      it('should fire load', function(done) {
        var db = new etherdb.database("dirty", {"filename": exports.TMP_PATH });
        db.on('init', function(length) {
          assert.strictEqual(length, 0);
          done();
        });
      });

      it('should fire drain after write', function(done) {
        var db = etherdb(file);
        db.on('load', function(length) {
          assert.strictEqual(length, 0);

          db.set('key', 'value');
          db.on('drain', function() {
            done();
          });

        });
      });

    });
/*
    describe('accessors', function(done) {
      after(cleanup);
      var db;

      it('.set should trigger callback', function(done) {
        db = etherdb(file);
        db.set('key', 'value', function(err) {
          assert.ok(!err);
          done();
        });
      });

      it('.get should return value', function() {
        assert.strictEqual(db.get('key'), 'value');
      });

      it('.path is valid', function() {
        assert.strictEqual(db.path, file);
      });

      it('.forEach runs for all', function() {
        var total = 2, count = 0;
        db.set('key1', 'value1');
        db.set('delete', 'me');

        db.rm('delete');

        var keys = ['key', 'key1'];
        var vals = ['value', 'value1'];

        db.forEach(function(key, val) {
          assert.strictEqual(key, keys[count]);
          assert.strictEqual(val, vals[count]);

          count ++;
        });

        assert.strictEqual(count, total);
      });

      it('.rm removes key/value pair', function() {
        db.set('test', 'test');
        assert.strictEqual(db.get('test'), 'test');
        db.rm('test');
        assert.strictEqual(db.get('test'), undefined);
      });

      it('will reload file from disk', function(done) {
        if (!file) {
          console.log('N/A in transient mode');
          return done();
        }

        db = etherdb(file);
        db.on('load', function(length) {
          assert.strictEqual(length, 2);
          assert.strictEqual(db.get('key'), 'value');
          assert.strictEqual(db.get('key1'), 'value1');
          done();
        });
      });
    });

    describe('db file close', function(done) {
      after(cleanup);

      it('close', function(done) {
        if (!file) {
          console.log('N/A in transient mode');
          return done();
        }
        var db = etherdb(file);
        db.on('load', function(length) {
          db.set('close', 'close');
          db.on('drain', function() {
            db.close();
          });
        });

        db.on('write_close',function() {
          done();
        });
      });
    });
*/
  });
}

etherdbAPITests('');
etherdbAPITests(config.TMP_PATH + '/apitest.etherdb');
