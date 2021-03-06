/*jshint bitwise:true, browser:false, camelcase:true, curly:true, devel:false, eqeqeq:false, forin:true, immed:true, indent:4, newcap:true, noarg:true, noempty:true, nonew:true, quotmark:true, regexp:false, strict:true, trailing:true, undef:true, unused:true, node:true */
'use strict';
var express = require('express');
var router = express.Router();
var tmp = require('tmp');
var fs = require('fs');
var sqlite3 = require('sqlite3'); //.verbose();

router.post('/', function (req, res) {
    // Use something more sensible.
    var locale = 'fr_FR';

    _removeOldExports(24);

    exportToDB(req.body, locale, res);
});

/** from http://stackoverflow.com/questions/19167297/in-node-delete-all-files-older-than-an-hour */
function _removeOldExports(ageInHours) {
    var exportDir = __dirname + '/../hiit-exports/';
    fs.readdir(exportDir, function (err, files) {
        files.forEach(function (file, index) {
            fs.stat(path.join(exportDir, file), function (err, stat) {
                var endTime, now;
                if (err) {
                    return console.error(err);
                }
                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + (3600 * 1000 * ageInHours);
                if (now > endTime) {
                    fs.unlink(path.join(exportDir, file), function (err) {
                        if (err) {
                            console.error(err);
                        }
                    });
                }
            });
        });
    });
}

function exportToDB(hiit, locale, res) {

    var tmpFile = tmp.tmpNameSync({
        template: 'export-XXXXXX.ahiit'
    });
    var dbFile = __dirname + '/../hiit-exports/' + tmpFile;

    console.log('Post Export DB: ' + dbFile);

    var db = new sqlite3.Database(dbFile, function (error) {
        if (error) {
            console.log('Cannot open database "' + dbFile + '": ' + error);
            res.json({
                error: error
            });
            return;
        }
    });

    //db.on('profile', function(sql, ms) { console.log('db-profile: [' + sql + '](' + ms + 'ms)'); });
    db.on('trace', function (sql) {
        console.log('db-trace  : [' + sql + ']');
    });

    db.serialize(function () {
        console.log('Tables creation');
        db.run('BEGIN TRANSACTION');
        db.run('PRAGMA foreign_keys=OFF');
        db.run('CREATE TABLE android_metadata (locale TEXT)');
        db.run('CREATE TABLE table_set (_id INTEGER PRIMARY KEY, set_name TEXT, rounds integer)');
        db.run('CREATE TABLE table_set_main (_id INTEGER PRIMARY KEY, set_id integer, action integer, time integer, color)');
        db.run('CREATE TABLE table_workout (_id INTEGER PRIMARY KEY, workout TEXT)');
        db.run('CREATE TABLE table_workout_main (_id INTEGER PRIMARY KEY, workout_id integer, set_id integer, action integer, time integer, color)');
        db.run('CREATE TABLE table_workout_set (_id INTEGER PRIMARY KEY, workout_id integer, set_name text, rounds integer)');
    });

    db.serialize(function () {
        var i, j, k;

        console.log('Data insertion');
        db.run('INSERT INTO android_metadata VALUES(?)', locale);

        // Add Ids to data
        var setId = 1;
        var actionId = 1;
        var workoutId = 1;
        var workoutSetId = 1;
        var workoutActionId = 1;

        var stmtSet = db.prepare('INSERT INTO "table_set" VALUES(?,?,?)');
        var stmtSetMain = db.prepare('INSERT INTO "table_set_main" VALUES(?,?,?,?,?)');
        var stmtWorkout = db.prepare('INSERT INTO "table_workout" VALUES(?,?)');
        var stmtWorkoutSet = db.prepare('INSERT INTO "table_workout_set" VALUES(?,?,?,?)');
        var stmtWorkoutMain = db.prepare('INSERT INTO "table_workout_main" VALUES(?,?,?,?,?,?)');

        for (i = 0; i < hiit.workouts.length; i++) {
            var workout = hiit.workouts[i];
            workout.id = workoutId;

            console.log(workout.id + '\t' + workout.name);

            stmtWorkout.run([workout.id, workout.name]);

            for (j = 0; j < workout.sets.length; j++) {
                var workoutSet = workout.sets[j];

                workoutSet.id = workoutSetId;

                console.log(workoutSet.id + '\t' + workoutSet.name);
                stmtWorkoutSet.run([workoutSet.id, workout.id, workoutSet.name, workoutSet.repetitions]);

                for (k = 0; k < workoutSet.actions.length; k++) {
                    var workoutAction = workoutSet.actions[k];
                    workoutAction.id = workoutActionId;
                    console.log('\t' + workoutAction.id + '\t' + workoutAction.name);
                    stmtWorkoutMain.run([workoutAction.id, workout.id, workoutSet.id, workoutAction.name, workoutAction.time, _intFromColor(workoutAction.color)]);

                    workoutActionId++;
                }
                workoutSetId++;
            }
            workoutId++;
        }

        for (i = 0; i < hiit.sets.length; i++) {
            var set = hiit.sets[i];
            set.id = setId;

            console.log(set.id + '\t' + set.name);

            stmtSet.run([set.id, set.name, set.repetitions]);

            for (j = 0; j < set.actions.length; j++) {
                var action = set.actions[j];
                console.log('\t' + actionId + '\t' + action.name);

                action.id = actionId;
                //console.log([action.id, set.id, action.name, action.time, _intFromColor(action.color)])
                stmtSetMain.run([action.id, set.id, action.name, action.time, _intFromColor(action.color)]);

                actionId++;
            }
            setId++;
        }

        stmtSet.finalize();
        stmtSetMain.finalize();
        stmtWorkout.finalize();
        stmtWorkoutSet.finalize();
        stmtWorkoutMain.finalize();
    });

    db.serialize(function () {
        console.log('DB commit');
        db.run('COMMIT');
    });

    db.serialize(function () {
        console.log('DB close');
        db.close(function (error) {
            if (error) {
                console.log('Cannot close database: ' + error);
                res.json({
                    error: error
                });
                return;
            }

            console.log('export done: /hiit/' + tmpFile);
            res.json({
                error: null,
                location: '/hiit/' + tmpFile
            });

            //res.download(dbFile, function (err) {
            //    if (error) {
            //        console.log(err);
            //        res.status(err.status).end();
            //    }});

        });
    });

}

/** Convert from a RGB (#FF00FF) color to Android int color code. */
function _intFromColor(color) {
    var cache, red, green, blue;
    cache = /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})/.exec(color);

    if (!cache) {
        return -1;
    }

    red = parseInt(cache[1], 16);
    green = parseInt(cache[2], 16);
    blue = parseInt(cache[3], 16);

    red = (red << 16) & 0x00FF0000; //Shift red 16-bits and mask out other stuff
    green = (green << 8) & 0x0000FF00; //Shift Green 8-bits and mask out other stuff
    blue = blue & 0x000000FF; //Mask out anything not blue.

    return 0xFF000000 | red | green | blue; //0xFF000000 for 100% Alpha. Bitwise OR everything together.
}

module.exports = router;
