import {Empire} from "../ai/Empire";
import {notifier} from "../notifier";
import {Operation} from "../ai/operations/Operation";
import {helper} from "./helper";
import {QuadOperation} from "../ai/operations/QuadOperation";
import {FlexOperation} from "../ai/operations/FlexOperation";
import {CACHE_INVALIDATION_FREQUENCY, CACHE_INVALIDATION_PERIOD} from "../config/constants";
import { consoleCommands } from "./consoleCommands";

const OPERATION_CLASSES = {
    flex: FlexOperation,
    quad: QuadOperation,
};

export var empire: Empire;

export var loopHelper = {

    initEmpire: function() {
        empire = new Empire();
        global.emp = empire;
        empire.init();
    },

    getOperations: function(empire: Empire): Operation[] {

        // gather flag data, instantiate operations
        let operationList: {[operationName: string]: Operation} = {};
        for (let flagName in Game.flags) {
            for (let typeName in OPERATION_CLASSES) {
                if (!OPERATION_CLASSES.hasOwnProperty(typeName)) continue;
                if (flagName.substring(0, typeName.length) === typeName) {
                    let operationClass = OPERATION_CLASSES[typeName];
                    let flag = Game.flags[flagName];
                    let name = flagName.substring(flagName.indexOf("_") + 1);

                    if (operationList.hasOwnProperty(name)) {
                        console.log(`operation with name ${name} already exists (type: ${operationList[name].type}), please use a different name`);
                        continue;
                    }

                    let operation;
                    try {
                        operation = new operationClass(flag, name, typeName, empire);
                    }
                    catch (e) {
                        console.log("error parsing flag name and bootstrapping operation");
                        console.log(e);
                    }

                    operationList[name] = operation;
                    global[name] = operation;
                }
            }
        }

        Game.operations = operationList;

        return _.sortBy(operationList, (operation: Operation) => operation.priority);
    },

    initMemory: function() {
        _.defaultsDeep(Memory, {
            stats: {},
            temp: {},
            playerConfig: {
                terminalNetworkRange: 6,
                muteSpawn: false,
                enableStats: false,
                creditReserveAmount: Number.MAX_VALUE,
                powerMinimum: 9000,
            },
            profiler: {},
            traders: {},
            powerObservers: {},
            notifier: [],
            cpu: {
                history: [],
                average: Game.cpu.getUsed(),
            },
            hostileMemory: {}
        });
    },

    scavangeResources: function() {
        for (let v in Game.rooms) {
            let room = Game.rooms[v];
            let resources = room.find(FIND_DROPPED_RESOURCES) as Resource[];
            for (let resource of resources) {
                if (resource.amount > 10) {
                    let creep = resource.pos.lookFor(LOOK_CREEPS)[0] as Creep;
                    if (creep && creep.my && creep.memory.scavanger === resource.resourceType
                        && (!creep.carry[resource.resourceType] || creep.carry[resource.resourceType] < creep.carryCapacity)) {
                        let outcome = creep.pickup(resource);
                    }
                }
            }
        }
    },

    invalidateCache: Game.time % CACHE_INVALIDATION_FREQUENCY < CACHE_INVALIDATION_PERIOD,



    initConsoleCommands: function() {
        // command functions found in consoleCommands.ts can be executed from the game console
        // example: cc.minv()
        global.cc = consoleCommands;
        global.note = notifier;
        global.helper = helper;
    },

    garbageCollection: function() {

        if (Game.time < Memory.nextGC) { return; }

        for (let id in Memory.hostileMemory) {
            let creep = Game.getObjectById<Creep>(id);
            if (!creep) { delete Memory.hostileMemory[id]; }
        }

        Memory.nextGC = Game.time += helper.randomInterval(100);
    }
};
