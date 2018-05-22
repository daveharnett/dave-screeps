import {loopHelper, empire} from "./helpers/loopHelper";
import {initPrototypes} from "./prototypes/initPrototypes";
import {Profiler} from "./Profiler";
import {TimeoutTracker} from "./TimeoutTracker";

loopHelper.initMemory();
initPrototypes();

module.exports.loop = function () {
    Game.cache = { structures: {}, hostiles: {}, hostilesAndLairs: {}, mineralCount: {}, labProcesses: {},
        activeLabCount: 0, placedRoad: false, fleeObjects: {}, lairThreats: {}};

    // TimeoutTracker - Diagnoses CPU timeouts
    try { TimeoutTracker.init(); } catch (e) { console.log("error initializing TimeoutTracker:\n", e.stack); }

    // Init phase - Information is gathered about the game state and game objects instantiated
    Profiler.start("init");
    loopHelper.initEmpire();
    let operations = loopHelper.getOperations(empire);
    for (let operation of operations) operation.init();
    Profiler.end("init");

    // RoleCall phase - Find creeps belonging to missions and spawn any additional needed.
    Profiler.start("roleCall");
    for (let operation of operations) operation.roleCall();
    Profiler.end("roleCall");

    // Actions phase - Actions that change the game state are executed in this phase.
    Profiler.start("actions");
    for (let operation of operations) operation.actions();
    Profiler.end("actions");

    // Finalize phase - Code that needs to run post-actions phase
    for (let operation of operations) operation.invalidateCache();
    Profiler.start("finalize");
    for (let operation of operations) operation.finalize();
    Profiler.end("finalize");

    // post-operation actions and utilities
    Profiler.start("postOperations");
    try { empire.actions(); } catch (e) { console.log("error with empire actions\n", e.stack); }
    try { loopHelper.scavangeResources(); } catch (e) { console.log("error scavanging:\n", e.stack); }
    try { loopHelper.initConsoleCommands(); } catch (e) { console.log("error loading console commands:\n", e.stack); }
    try { loopHelper.garbageCollection(); } catch (e) { console.log("error during garbage collection:\n", e.stack ); }
    Profiler.end("postOperations");
    try { Profiler.finalize(); } catch (e) { console.log("error checking Profiler:\n", e.stack); }
    try { TimeoutTracker.finalize(); } catch (e) { console.log("error finalizing TimeoutTracker:\n", e.stack); }
};

