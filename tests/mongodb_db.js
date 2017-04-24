var expect = require('expect.js');

var mongoDB             = require('../mongodb_db');
var defaultTestSettings = require('../defaultTestSettings.js').mongodb;
var ueberDB             = require('../CloneAndAtomicLayer');

describe('the mongodb adapter', function() {
  context('.database()', function() {
    var settings;
    var subject = function() { mongoDB.database(settings) };

    beforeEach(function() {
      // initiate settings with mandatory values
      settings = {
        host: 'the host',
        dbname: 'the db name',
        port: 1234,
      };
    });

    context('mandatory values on "settings"', function() {
      it('requires settings', function() {
        settings = null;
        expect(subject).to.throwException();
      });

      context('when settings.url is not provided', function() {
        beforeEach(function() {
          delete settings.url;
        });

        it('requires settings.host', function() {
          delete settings.host;
          expect(subject).to.throwException();
        });

        it('requires settings.dbname', function() {
          delete settings.dbname;
          expect(subject).to.throwException();
        });

        it('requires settings.port', function() {
          delete settings.port;
          expect(subject).to.throwException();
        });
      });

      context('when settings.url is provided', function() {
        beforeEach(function() {
          settings.url = 'the url';
        });

        it('does not require settings.host', function() {
          delete settings.host;
          expect(subject).to.not.throwException();
        });

        it('does not require settings.dbname', function() {
          delete settings.dbname;
          expect(subject).to.not.throwException();
        });

        it('does not require settings.port', function() {
          delete settings.port;
          expect(subject).to.not.throwException();
        });
      });
    });
  });

  context('init()', function() {
    context('SSL settings', function() {
      var FILE_PATH = '/tmp/sslFile.txt';
      var FILE_CONTENT = 'The file content.';

      var settings, db;
      var subject = function(done) {
        db = new ueberDB.database('mongodb', settings);
        db.init(done);
      };

      before(function(done) {
        // create a file with defined content
        require('fs').writeFile(FILE_PATH, FILE_CONTENT, done);
      });

      beforeEach(function() {
        var defaultSettings = defaultTestSettings;

        // initiate settings with mandatory values
        settings = {
          host:   defaultSettings.host,
          dbname: defaultSettings.dbname,
          port:   defaultSettings.port,
          extra:  {},
        };
      });

      afterEach(function(done) {
        if (db) db.close(done);
        else done();
      });

      // the test to be repeated on all contexts that can have a certificate content
      var testCertificatesAreLoadedOnSslConfigs = function(getSslSettingsRoot) {
        // any of these values can have a path to a .pem file
        ['sslCA', 'sslKey', 'sslCert'].forEach(function(config) {
          var ueberConfig = config + 'Path';

          context('and "' + ueberConfig + '" is provided on extra connection settings', function() {
            beforeEach(function(done) {
              var sslSettingsRoot = getSslSettingsRoot();
              sslSettingsRoot[ueberConfig] = FILE_PATH;
              subject(done);
            });

            it('loads file content into "' + config + '" property', function(done) {
              var sslSettingsRoot = getSslSettingsRoot();
              expect(sslSettingsRoot[config].toString()).to.be(FILE_CONTENT);
              done();
            });

            // "sslCA" property needs to be replicated into "ca" setting too
            // https://www.compose.com/articles/one-missing-key-and-how-it-broke-node-js-and-mongodb/
            if (config === 'sslCA') {
              it('also loads file content into "ca" property', function(done) {
                var sslSettingsRoot = getSslSettingsRoot();
                expect(sslSettingsRoot['ca'].toString()).to.be(FILE_CONTENT);
                done();
              });
            }
          });
        });
      }

      var sslOnRootSettings = function() { return settings.extra }
      var sslOnServer       = function() { return settings.extra.server }
      var sslOnReplicaSet   = function() { return settings.extra.replset }
      var sslOnMongosProxy  = function() { return settings.extra.mongos }

      // for mongodb 2.2
      context('when SSL settings are on root', function() {
        testCertificatesAreLoadedOnSslConfigs(sslOnRootSettings);
      });

      // for mongodb 2.0
      context('when SSL settings are on "server"', function() {
        beforeEach(function() {
          settings.extra.server = {};
        });
        testCertificatesAreLoadedOnSslConfigs(sslOnServer);
      });
      context('when SSL settings are on "replset"', function() {
        beforeEach(function() {
          settings.extra.replset = {};
        });
        testCertificatesAreLoadedOnSslConfigs(sslOnReplicaSet);
      });
      context('when SSL settings are on "mongos"', function() {
        beforeEach(function() {
          settings.extra.mongos = {};
        });
        testCertificatesAreLoadedOnSslConfigs(sslOnMongosProxy);
      });
    });
  });

  context('.set() and .get()', function() {
    var KEY = 'the key';

    var db;

    before(function(done) {
      db = new ueberDB.database('mongodb', defaultTestSettings);
      db.init(done);
    });

    after(function(done) {
      db.close(done);
    });

    it('creates a record and retrieves it', function(done) {
      var value = 'the value';

      db.set(KEY, value, null, function() {
        db.get(KEY, function(err, valueFound) {
          expect(valueFound).to.be(value);
          done();
        });
      });
    });

    it('returns null when the original record value is null', function(done) {
      var value = null;

      db.set(KEY, value, null, function() {
        db.get(KEY, function(err, valueFound) {
          expect(valueFound).to.be(null);
          done();
        });
      });
    });
  });

  context('.findKeys()', function() {
    var db;

    before(function(done) {
      db = new ueberDB.database('mongodb', defaultTestSettings);
      db.init(function() {
        // set initial values as on the example of
        // https://github.com/Pita/ueberDB/wiki/findKeys-functionality#how-it-works
        db.set('test:id1', 'VALUE', null, function() {
          db.set('test:id1:chat:id2', 'VALUE', null, function() {
            db.set('chat:id3:test:id4', 'VALUE', null, done);
          });
        });
      });
    });

    after(function(done) {
      db.close(done);
    });

    it('returns all matched keys when "notkey" is null', function(done) {
      db.findKeys('test:*', null, function(err, keysFound) {
        expect(keysFound).to.have.length(2);
        expect(keysFound).to.contain('test:id1');
        expect(keysFound).to.contain('test:id1:chat:id2');
        done();
      });
    });

    // same scenario of https://github.com/Pita/ueberDB/wiki/findKeys-functionality
    it('returns the only matched "key" that does not match "notkey"', function(done) {
      db.findKeys('test:*', '*:*:*', function(err, keysFound) {
        expect(keysFound).to.have.length(1);
        expect(keysFound).to.contain('test:id1');
        done();
      });
    });

    it('returns an empty array when no key is found', function(done) {
      db.findKeys('nomatch', null, function(err, keysFound) {
        expect(keysFound).to.have.length(0);
        done();
      });
    });
  });
});
