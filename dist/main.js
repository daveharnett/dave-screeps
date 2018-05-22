'use strict';

class SpawnGroup {
    constructor(room) {
        this.room = room;
        this.spawns = _.filter(this.room.find(FIND_MY_SPAWNS), s => s.canCreateCreep([MOVE]) !== ERR_RCL_NOT_ENOUGH);
        if (!this.room.memory.spawnMemory)
            this.room.memory.spawnMemory = {};
        this.memory = this.room.memory.spawnMemory;
        this.extensions = room.findStructures(STRUCTURE_EXTENSION);
        this.manageSpawnLog();
        this.availableSpawnCount = this.getSpawnAvailability();
        this.isAvailable = this.availableSpawnCount > 0;
        this.currentSpawnEnergy = this.room.energyAvailable;
        this.maxSpawnEnergy = this.room.energyCapacityAvailable;
        this.pos = _.head(this.spawns).pos;
    }
    spawn(build, name, memory, reservation) {
        let outcome;
        this.isAvailable = false;
        if (reservation) {
            if (this.availableSpawnCount < reservation.spawns)
                return ERR_BUSY;
            if (this.currentSpawnEnergy < reservation.currentEnergy)
                return ERR_NOT_ENOUGH_RESOURCES;
        }
        for (let spawn of this.spawns) {
            if (spawn.spawning == null) {
                outcome = spawn.createCreep(build, name, memory);
                if (Memory.playerConfig.muteSpawn)
                    break; // early
                if (outcome === ERR_INVALID_ARGS) {
                    console.log("SPAWN: invalid args for creep\nbuild:", build, "\nname:", name, "\ncount:", build.length);
                }
                if (_.isString(outcome)) {
                    console.log("SPAWN: building " + name);
                }
                else if (outcome === ERR_NOT_ENOUGH_RESOURCES) {
                    if (Game.time % 10 === 0) {
                        console.log("SPAWN:", this.room.name, "not enough energy for", name, "cost:", SpawnGroup.calculateBodyCost(build), "current:", this.currentSpawnEnergy, "max", this.maxSpawnEnergy);
                    }
                }
                else if (outcome !== ERR_NAME_EXISTS && outcome !== ERR_RCL_NOT_ENOUGH) {
                    console.log("SPAWN:", this.room.name, "had error spawning " + name + ", outcome: " + outcome);
                }
                break;
            }
        }
        return outcome;
    }
    getSpawnAvailability() {
        let count = 0;
        for (let spawn of this.spawns) {
            if (spawn.spawning === null) {
                count++;
            }
        }
        this.memory.log.availability += count;
        Memory.stats["spawnGroups." + this.room.name + ".idleCount"] = count;
        return count;
    }
    getCurrentSpawnEnergy() {
        let sum = 0;
        for (let ext of this.extensions) {
            sum += ext.energy;
        }
        for (let spawn of this.spawns) {
            sum += spawn.energy;
        }
        return sum;
    }
    getMaxSpawnEnergy() {
        let contollerLevel = this.room.controller.level;
        let extensionCount = this.extensions.length;
        let spawnCount = this.spawns.length;
        return spawnCount * SPAWN_ENERGY_CAPACITY + extensionCount * EXTENSION_ENERGY_CAPACITY[contollerLevel];
    }
    static calculateBodyCost(body) {
        let sum = 0;
        for (let part of body) {
            sum += BODYPART_COST[part];
        }
        return sum;
    }
    canCreateCreep(body) {
        let cost = SpawnGroup.calculateBodyCost(body);
        return cost <= this.currentSpawnEnergy;
    }
    // proportion allows you to scale down the body size if you don't want to use all of your spawning energy
    // for example, proportion of .5 would return the max units per cost if only want to use half of your spawning capacity
    maxUnitsPerCost(unitCost, proportion = 1) {
        return Math.floor((this.maxSpawnEnergy * proportion) / unitCost);
    }
    maxUnits(body, proportion) {
        let cost = SpawnGroup.calculateBodyCost(body);
        return Math.min(this.maxUnitsPerCost(cost, proportion), Math.floor(50 / body.length));
    }
    manageSpawnLog() {
        if (!this.memory.log)
            this.memory.log = { availability: 0, history: [], longHistory: [] };
        if (Game.time % 100 !== 0)
            return; // early
        let log = this.memory.log;
        let average = log.availability / 100;
        log.availability = 0;
        /*
        if (average > 1) console.log("SPAWNING:", this.missionRoom, "not very busy (avg", average, "idle out of",
            this.spawns.length, "), perhaps add more harvesting");
        if (average < .1) console.log("SPAWNING:", this.missionRoom, "very busy (avg", average, "idle out of",
            this.spawns.length, "), might want to reduce harvesting");
            */
        log.history.push(average);
        while (log.history.length > 5)
            log.history.shift();
        if (Game.time % 500 !== 0)
            return; // early
        let longAverage = _.sum(log.history) / 5;
        log.longHistory.push(longAverage);
        while (log.longHistory.length > 5)
            log.longHistory.shift();
    }
    showHistory() {
        console.log("Average availability in", this.room.name, "the last 5 creep generations (1500 ticks):");
        console.log(this.memory.log.history);
        console.log("Average availability over the last 75000 ticks (each represents a period of 15000 ticks)");
        console.log(this.memory.log.longHistory);
    }
    get averageAvailability() {
        if (this.memory.log.history.length === 0) {
            return .1;
        }
        return _.last(this.memory.log.history);
    }
}

const notifier = {
    log(message, severity = 5) {
        let styles = {
            [0]: () => console.log(message),
            [1]: () => console.log(`<font color="#00FF00" severity="1">${message}</font>`),
            [2]: () => console.log(`<font color="#00FFFF" severity="2">${message}</font>`),
            [3]: () => console.log(`<font color="#FFFF00" severity="3">${message}</font>`),
            [4]: () => console.log(`<font color="#FF00FF" severity="4">${message}</font>`),
            [5]: () => console.log(`<font color="#FF0000" severity="4">${message}</font>`),
        };
        if (styles[severity]) {
            styles[severity]();
        }
        if (severity === 5) {
            Memory.notifier.push({ time: Game.time, earthTime: this.earthTime(-7), message: message });
        }
        while (Memory.notifier.length > 1000) {
            Memory.notifier.shift();
        }
    },
    review(limit = Number.MAX_VALUE, burnAfterReading = false) {
        let messageCount = Memory.notifier.length;
        let count = 0;
        for (let value of Memory.notifier) {
            let secondsElapsed = (Game.time - value.time) * 3;
            let seconds = secondsElapsed % 60;
            let minutes = Math.floor(secondsElapsed / 60);
            let hours = Math.floor(secondsElapsed / 3600);
            console.log(`\n${value.time} (roughly ${hours > 0 ? `${hours} hours, ` : ""}${minutes > 0 ? `${minutes} minutes, ` : ""}${seconds > 0 ? `${seconds} seconds ` : ""}ago)`);
            console.log(`${value.message}`);
            count++;
            if (count >= limit) {
                break;
            }
        }
        let destroyed = 0;
        if (burnAfterReading) {
            while (Memory.notifier.length > 0) {
                Memory.notifier.shift();
                destroyed++;
                if (destroyed >= limit) {
                    break;
                }
            }
        }
        return `viewing ${count} of ${messageCount} notifications`;
    },
    clear(term) {
        if (term) {
            let count = 0;
            term = term.toLocaleLowerCase();
            let newArray = [];
            for (let value of Memory.notifier) {
                if (value.message.toLocaleLowerCase().indexOf(term) < 0) {
                    newArray.push(value);
                    count++;
                }
                Memory.notifier = newArray;
            }
            return `removed ${count} messages;`;
        }
        else {
            let count = Memory.notifier.length;
            Memory.notifier = [];
            return `removed ${count} messages;`;
        }
    }
};

class Profiler {
    static start(identifier, consoleReport = false, period = 5) {
        let profile = this.initProfile(identifier, consoleReport, period);
        profile.cpu = Game.cpu.getUsed();
    }
    static end(identifier) {
        let profile = Memory.profiler[identifier];
        profile.total += Game.cpu.getUsed() - profile.cpu;
        profile.count++;
    }
    static resultOnly(identifier, result, consoleReport = false, period = 5) {
        let profile = this.initProfile(identifier, consoleReport, period);
        profile.total += result;
        profile.count++;
    }
    static initProfile(identifier, consoleReport, period) {
        if (!Memory.profiler[identifier]) {
            Memory.profiler[identifier] = {};
        }
        _.defaults(Memory.profiler[identifier], { total: 0, count: 0, startOfPeriod: Game.time - 1 });
        Memory.profiler[identifier].period = period;
        Memory.profiler[identifier].consoleReport = consoleReport;
        Memory.profiler[identifier].lastTickTracked = Game.time;
        return Memory.profiler[identifier];
    }
    static finalize() {
        for (let identifier in Memory.profiler) {
            let profile = Memory.profiler[identifier];
            if (Game.time - profile.startOfPeriod >= profile.period) {
                if (profile.count !== 0) {
                    profile.costPerCall = _.round(profile.total / profile.count, 2);
                }
                profile.costPerTick = _.round(profile.total / profile.period, 2);
                profile.callsPerTick = _.round(profile.count / profile.period, 2);
                if (profile.consoleReport) {
                    console.log("PROFILER:", identifier, "perTick:", profile.costPerTick, "perCall:", profile.costPerCall, "calls per tick:", profile.callsPerTick);
                }
                profile.startOfPeriod = Game.time;
                profile.total = 0;
                profile.count = 0;
            }
            if (Game.time - profile.lastTickTracked > 100) {
                delete Memory.profiler[identifier];
            }
        }
        if (Game.time % 10 === 0) {
            // Memory serialization will cause additional CPU use, better to err on the conservative side
            Memory.cpu.history.push(Game.cpu.getUsed() + Game.gcl.level / 5);
            Memory.cpu.average = _.sum(Memory.cpu.history) / Memory.cpu.history.length;
            while (Memory.cpu.history.length > 100) {
                Memory.cpu.history.shift();
            }
        }
    }
    static proportionUsed() {
        return Memory.cpu.average / (Game.gcl.level * 10 + 20);
    }
}

const REPORT_CPU_THRESHOLD = 2000;
const DEFAULT_MAXOPS = 20000;
const DEFAULT_STUCK_VALUE = 5;
class Traveler {
    constructor() {
        this.structureMatrixCache = {};
        this.creepMatrixCache = {};
    }
    findRoute(origin, destination, options = {}) {
        _.defaults(options, { restrictDistance: 16 });
        if (Game.map.getRoomLinearDistance(origin, destination) > options.restrictDistance) {
            return;
        }
        let allowedRooms = { [origin]: true, [destination]: true };
        let ret = Game.map.findRoute(origin, destination, {
            routeCallback: (roomName) => {
                if (options.routeCallback) {
                    let outcome = options.routeCallback(roomName);
                    if (outcome !== undefined) {
                        return outcome;
                    }
                }
                if (Game.map.getRoomLinearDistance(origin, roomName) > options.restrictDistance) {
                    return false;
                }
                let parsed;
                if (options.preferHighway) {
                    parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
                    let isHighway = (parsed[1] % 10 === 0) || (parsed[2] % 10 === 0);
                    if (isHighway) {
                        return 1;
                    }
                }
                // SK rooms are avoided when there is no vision in the room, harvested-from SK rooms are allowed
                if (!options.allowSK && !Game.rooms[roomName]) {
                    if (!parsed) {
                        parsed = /^[WE]([0-9]+)[NS]([0-9]+)$/.exec(roomName);
                    }
                    let fMod = parsed[1] % 10;
                    let sMod = parsed[2] % 10;
                    let isSK = !(fMod === 5 && sMod === 5) &&
                        ((fMod >= 4) && (fMod <= 6)) &&
                        ((sMod >= 4) && (sMod <= 6));
                    if (isSK) {
                        return 10;
                    }
                }
                if (!options.allowHostile && Traveler.checkOccupied(roomName) &&
                    roomName !== destination && roomName !== origin) {
                    return Number.POSITIVE_INFINITY;
                }
                return 2.5;
            },
        });
        if (!_.isArray(ret)) {
            console.log(`couldn't findRoute to ${destination}`);
            return;
        }
        for (let value of ret) {
            allowedRooms[value.room] = true;
        }
        return allowedRooms;
    }
    routeDistance(origin, destination) {
        let linearDistance = Game.map.getRoomLinearDistance(origin, destination);
        if (linearDistance >= 20) {
            return linearDistance;
        }
        let allowedRooms = this.findRoute(origin, destination);
        if (allowedRooms) {
            return Object.keys(allowedRooms).length;
        }
    }
    findTravelPath(origin, destination, options = {}) {
        _.defaults(options, {
            ignoreCreeps: true,
            maxOps: DEFAULT_MAXOPS,
            range: 1,
            obstacles: [],
        });
        if (options.movingTarget) {
            options.range = 0;
        }
        let allowedRooms;
        if (options.useFindRoute || (options.useFindRoute === undefined &&
            Game.map.getRoomLinearDistance(origin.pos.roomName, destination.pos.roomName) > 2)) {
            allowedRooms = this.findRoute(origin.pos.roomName, destination.pos.roomName, options);
        }
        let callback = (roomName) => {
            if (allowedRooms) {
                if (!allowedRooms[roomName]) {
                    return false;
                }
            }
            else if (!options.allowHostile && Traveler.checkOccupied(roomName)) {
                return false;
            }
            let matrix;
            let room = Game.rooms[roomName];
            if (room) {
                if (options.ignoreStructures) {
                    matrix = new PathFinder.CostMatrix();
                    if (!options.ignoreCreeps) {
                        Traveler.addCreepsToMatrix(room, matrix);
                    }
                }
                else if (options.ignoreCreeps || roomName !== origin.pos.roomName) {
                    matrix = this.getStructureMatrix(room, options.freshMatrix);
                }
                else {
                    matrix = this.getCreepMatrix(room);
                }
                for (let obstacle of options.obstacles) {
                    matrix.set(obstacle.pos.x, obstacle.pos.y, 0xff);
                }
            }
            if (options.roomCallback) {
                if (!matrix) {
                    matrix = new PathFinder.CostMatrix();
                }
                let outcome = options.roomCallback(roomName, matrix.clone());
                if (outcome !== undefined) {
                    return outcome;
                }
            }
            return matrix;
        };
        return PathFinder.search(origin.pos, { pos: destination.pos, range: options.range }, {
            maxOps: options.maxOps,
            plainCost: options.offRoad ? 1 : options.ignoreRoads ? 1 : 2,
            swampCost: options.offRoad ? 1 : options.ignoreRoads ? 5 : 10,
            roomCallback: callback,
        });
    }
    travelTo(creep, destination, options = {}) {
        /* uncomment if you would like to register hostile rooms entered
        if (creep.room.controller) {
            if (creep.room.controller.owner && !creep.room.controller.my) {
                creep.room.memory.occupied = true;
            } else {
                delete creep.room.memory.occupied;
            }
        }
        */
        // initialize data object
        if (!creep.memory._travel) {
            creep.memory._travel = { stuck: 0, tick: Game.time, cpu: 0, count: 0 };
        }
        let travelData = creep.memory._travel;
        if (creep.fatigue > 0) {
            travelData.tick = Game.time;
            return ERR_BUSY;
        }
        if (!destination) {
            return ERR_INVALID_ARGS;
        }
        // manage case where creep is nearby destination
        let rangeToDestination = creep.pos.getRangeTo(destination);
        if (rangeToDestination <= options.range) {
            return OK;
        }
        else if (rangeToDestination <= 1) {
            if (rangeToDestination === 1 && !options.range) {
                if (options.returnData) {
                    options.returnData.nextPos = destination.pos;
                }
                return creep.move(creep.pos.getDirectionTo(destination));
            }
            return OK;
        }
        // check if creep is stuck
        let hasMoved = true;
        if (travelData.prev) {
            travelData.prev = Traveler.initPosition(travelData.prev);
            if (creep.pos.inRangeTo(travelData.prev, 0)) {
                hasMoved = false;
                travelData.stuck++;
            }
            else {
                travelData.stuck = 0;
            }
        }
        // handle case where creep is stuck
        if (!options.stuckValue) {
            options.stuckValue = DEFAULT_STUCK_VALUE;
        }
        if (travelData.stuck >= options.stuckValue && !options.ignoreStuck) {
            options.ignoreCreeps = false;
            options.freshMatrix = true;
            delete travelData.path;
        }
        // handle case where creep wasn't traveling last tick and may have moved, but destination is still the same
        if (Game.time - travelData.tick > 1 && hasMoved) {
            delete travelData.path;
        }
        travelData.tick = Game.time;
        // delete path cache if destination is different
        if (!travelData.dest || travelData.dest.x !== destination.pos.x || travelData.dest.y !== destination.pos.y ||
            travelData.dest.roomName !== destination.pos.roomName) {
            if (travelData.dest && options.movingTarget) {
                let dest = Traveler.initPosition(travelData.dest);
                if (dest.isNearTo(destination)) {
                    travelData.path += dest.getDirectionTo(destination);
                    travelData.dest = destination.pos;
                }
                else {
                    delete travelData.path;
                }
            }
            else {
                delete travelData.path;
            }
        }
        // pathfinding
        if (!travelData.path) {
            if (creep.spawning) {
                return ERR_BUSY;
            }
            travelData.dest = destination.pos;
            travelData.prev = undefined;
            let cpu = Game.cpu.getUsed();
            let ret = this.findTravelPath(creep, destination, options);
            travelData.cpu += (Game.cpu.getUsed() - cpu);
            travelData.count++;
            if (travelData.cpu > REPORT_CPU_THRESHOLD) {
                console.log(`TRAVELER: heavy cpu use: ${creep.name}, cpu: ${_.round(travelData.cpu, 2)},\n` +
                    `origin: ${creep.pos}, dest: ${destination.pos}`);
            }
            if (ret.incomplete) {
                // console.log(`TRAVELER: incomplete path for ${creep.name}`);
                if (ret.ops < 2000 && options.useFindRoute === undefined && travelData.stuck < DEFAULT_STUCK_VALUE) {
                    options.useFindRoute = false;
                    ret = this.findTravelPath(creep, destination, options);
                    console.log(`attempting path without findRoute was ${ret.incomplete ? "not" : ""} successful`);
                }
            }
            travelData.path = Traveler.serializePath(creep.pos, ret.path);
            travelData.stuck = 0;
        }
        if (!travelData.path || travelData.path.length === 0) {
            return ERR_NO_PATH;
        }
        // consume path and move
        if (travelData.prev && travelData.stuck === 0) {
            travelData.path = travelData.path.substr(1);
        }
        travelData.prev = creep.pos;
        let nextDirection = parseInt(travelData.path[0], 10);
        if (options.returnData) {
            options.returnData.nextPos = Traveler.positionAtDirection(creep.pos, nextDirection);
        }
        return creep.move(nextDirection);
    }
    // unused and untested so far
    generateCachedPath(origin, destination) {
        let ret = this.findTravelPath(origin, destination);
        if (ret.incomplete) {
            console.log(`TRAVELER: cachedPath generation incomplete, ${origin.pos} -> ${destination.pos}, ${ret.ops}`);
            return;
        }
        return {
            start: _.head(ret.path),
            finish: _.last(ret.path),
            path: Traveler.serializePath(_.head(ret.path), ret.path),
        };
    }
    // unused and untested so far
    travelByCachedPath(creep, cachedPath) {
        if (!creep.memory._ctrav) {
            creep.memory._ctrav = { progress: 0, phase: 0 };
        }
        let travelData = creep.memory._ctrav;
        if (travelData.tempDest) {
            let tempDest = Traveler.initPosition(travelData.tempDest);
            if (creep.pos.inRangeTo(tempDest, 0)) {
                delete travelData.tempDest;
            }
            else {
                return this.travelTo(creep, { pos: tempDest });
            }
        }
        if (travelData.phase === 0) {
            let startPos = Traveler.initPosition(cachedPath.start);
            if (creep.pos.inRangeTo(startPos, 0)) {
                travelData.phase++;
                travelData.progress = 0;
            }
            else {
                travelData.tempDest = startPos;
                return this.travelByCachedPath(creep, cachedPath);
            }
        }
        if (travelData.phase === 1) {
            let nextDirection = cachedPath.path[travelData.progress];
        }
    }
    getStructureMatrix(room, freshMatrix) {
        if (!this.structureMatrixCache[room.name] || (freshMatrix && Game.time !== this.structureMatrixTick)) {
            this.structureMatrixTick = Game.time;
            let matrix = new PathFinder.CostMatrix();
            this.structureMatrixCache[room.name] = Traveler.addStructuresToMatrix(room, matrix, 1);
        }
        return this.structureMatrixCache[room.name];
    }
    static initPosition(pos) {
        return new RoomPosition(pos.x, pos.y, pos.roomName);
    }
    static addStructuresToMatrix(room, matrix, roadCost) {
        let impassibleStructures = [];
        for (let structure of room.find(FIND_STRUCTURES)) {
            if (structure instanceof StructureRampart) {
                if (!structure.my) {
                    impassibleStructures.push(structure);
                }
            }
            else if (structure instanceof StructureRoad) {
                matrix.set(structure.pos.x, structure.pos.y, roadCost);
            }
            else if (structure instanceof StructureContainer) {
                matrix.set(structure.pos.x, structure.pos.y, 5);
            }
            else {
                impassibleStructures.push(structure);
            }
        }
        for (let site of room.find(FIND_CONSTRUCTION_SITES)) {
            if (site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD) {
                continue;
            }
            matrix.set(site.pos.x, site.pos.y, 0xff);
        }
        for (let structure of impassibleStructures) {
            matrix.set(structure.pos.x, structure.pos.y, 0xff);
        }
        return matrix;
    }
    getCreepMatrix(room) {
        if (!this.creepMatrixCache[room.name] || Game.time !== this.creepMatrixTick) {
            this.creepMatrixTick = Game.time;
            this.creepMatrixCache[room.name] = Traveler.addCreepsToMatrix(room, this.getStructureMatrix(room, true).clone());
        }
        return this.creepMatrixCache[room.name];
    }
    static addCreepsToMatrix(room, matrix) {
        room.find(FIND_CREEPS).forEach((creep) => matrix.set(creep.pos.x, creep.pos.y, 0xff));
        return matrix;
    }
    static serializePath(startPos, path, display = true) {
        let serializedPath = "";
        let lastPosition = startPos;
        for (let position of path) {
            if (position.roomName === lastPosition.roomName) {
                if (display) {
                    new RoomVisual(position.roomName).line(position, lastPosition, { color: 'orange', lineStyle: 'dashed' });
                }
                serializedPath += lastPosition.getDirectionTo(position);
            }
            lastPosition = position;
        }
        return serializedPath;
    }
    static positionAtDirection(origin, direction) {
        let offsetX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
        let offsetY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
        return new RoomPosition(origin.x + offsetX[direction], origin.y + offsetY[direction], origin.roomName);
    }
    static checkOccupied(roomName) {
        return Memory.rooms[roomName] && Memory.rooms[roomName].occupied;
    }
}
// uncomment this to have an instance of traveler available through import
const traveler = new Traveler();
// uncomment to assign an instance to global
// global.traveler = new Traveler();
// uncomment this block to assign a function to Creep.prototype: creep.travelTo(destination)
/*
const traveler = new Traveler();
Creep.prototype.travelTo = function(destination: {pos: RoomPosition}, options?: TravelToOptions) {
    return traveler.travelTo(this, destination, options);
};
*/

class WorldMap {
    constructor(diplomat) {
        this.controlledRooms = {};
        this.allyMap = {};
        this.allyRooms = [];
        this.tradeMap = {};
        this.tradeRooms = [];
        this.foesMap = {};
        this.foesRooms = [];
        this.artRooms = ARTROOMS;
        this.diplomat = diplomat;
        if (!Memory.empire) {
            Memory.empire = {};
        }
        _.defaults(Memory.empire, {
            activeNukes: {}
        });
        this.activeNukes = Memory.empire.activeNukes;
    }
    init() {
        let spawnGroups = {};
        for (let roomName in Memory.rooms) {
            let memory = Memory.rooms[roomName];
            let room = Game.rooms[roomName];
            if (room) {
                this.updateMemory(room);
                if (room.controller && room.controller.my) {
                    this.radar(room);
                    this.controlledRooms[roomName] = room;
                    if (room.find(FIND_MY_SPAWNS).length > 0) {
                        spawnGroups[roomName] = new SpawnGroup(room);
                    }
                }
            }
            if (this.diplomat.allies[memory.owner]) {
                this.allyMap[roomName] = memory;
                if (room) {
                    this.allyRooms.push(room);
                }
            }
            if (this.diplomat.foes[memory.owner]) {
                this.foesMap[roomName] = memory;
                if (room) {
                    this.foesRooms.push(room);
                }
            }
            if (memory.nextTrade) {
                this.tradeMap[roomName] = memory;
                if (room) {
                    this.tradeRooms.push(room);
                }
            }
        }
        return spawnGroups;
    }
    actions() {
        this.reportNukes();
    }
    addNuke(activeNuke) {
        this.activeNukes.push(activeNuke);
    }
    reportNukes() {
        if (Game.time % TICK_FULL_REPORT !== 0)
            return;
        for (let activeNuke of this.activeNukes) {
            console.log(`EMPIRE: ${Game.time - activeNuke.tick} till our nuke lands in ${activeNuke.roomName}`);
        }
    }
    updateMemory(room) {
        if (room.controller) {
            room.memory.level = room.controller.level;
            if (room.controller.owner) {
                room.memory.owner = room.controller.owner.username;
            }
            if (room.controller.owner && !room.controller.my) {
                // uncomment to enable travel through ally rooms
                /* if (this.diplomat.allies[room.controller.owner.username]) {
                    delete room.memory.occupied;
                    return;
                }*/
                room.memory.occupied = true;
            }
            else if (room.memory.occupied) {
                delete room.memory.occupied;
            }
        }
    }
    radar(scanningRoom) {
        if (scanningRoom.controller.level < 8) {
            return;
        }
        if (Game.time < scanningRoom.memory.nextRadar) {
            return;
        }
        // find observer
        let observer = _(scanningRoom.find(FIND_STRUCTURES))
            .filter(s => s.structureType === STRUCTURE_OBSERVER)
            .head();
        if (!observer) {
            console.log(`NETWORK: please add an observer in ${scanningRoom.name} to participate in network`);
            scanningRoom.memory.nextRadar = Game.time + 1000;
            return;
        }
        if (!scanningRoom.memory.radarData) {
            console.log(`NETWORK: Beginning full radar scan in ${scanningRoom.name}`);
            scanningRoom.memory.radarData = { x: -10, y: -10 };
        }
        let radarData = scanningRoom.memory.radarData;
        // scan loop
        let scanComplete = false;
        while (!scanComplete) {
            let roomName = WorldMap.findRelativeRoomName(scanningRoom.name, radarData.x, radarData.y);
            let scannedRoom = Game.rooms[roomName];
            if (scannedRoom) {
                scannedRoom.memory.nextScan = Game.time + RADAR_INTERVAL;
                this.evaluateTrade(scannedRoom);
                // TODO: room selection code
            }
            else {
                if (!Memory.rooms[roomName])
                    Memory.rooms[roomName] = {};
                let roomMemory = Memory.rooms[roomName];
                if (!roomMemory.nextScan || Game.time >= roomMemory.nextScan) {
                    observer.observeRoom(roomName);
                    break;
                }
            }
            scanComplete = this.incrementScan(radarData);
            if (scanComplete) {
                scanningRoom.memory.nextRadar = Game.time + RADAR_INTERVAL;
                console.log(`RADAR: Scan complete at ${scanningRoom.name}`);
                delete scanningRoom.memory.radarData;
            }
        }
    }
    evaluateTrade(room) {
        if (!room.controller || room.controller.my //|| !TradeNetwork.canTrade(room)
            || !this.diplomat.partners[room.controller.owner.username]) {
            return;
        }
        if (!room.memory.nextTrade) {
            room.memory.nextTrade = Game.time;
        }
    }
    incrementScan(radarData) {
        // increment
        radarData.x++;
        if (radarData.x > 10) {
            radarData.x = -10;
            radarData.y++;
            if (radarData.y > 10) {
                return true;
            }
        }
    }
    static findRelativeRoomName(roomName, xDelta, yDelta) {
        let coords = this.getRoomCoordinates(roomName);
        let xDir = coords.xDir;
        let yDir = coords.yDir;
        let x = coords.x + xDelta;
        let y = coords.y + yDelta;
        if (x < 0) {
            x = Math.abs(x) - 1;
            xDir = this.negaDirection(xDir);
        }
        if (y < 0) {
            y = Math.abs(y) - 1;
            yDir = this.negaDirection(yDir);
        }
        return xDir + x + yDir + y;
    }
    static findRoomCoordDeltas(origin, otherRoom) {
        let originCoords = this.getRoomCoordinates(origin);
        let otherCoords = this.getRoomCoordinates(otherRoom);
        let xDelta = otherCoords.x - originCoords.x;
        if (originCoords.xDir === otherCoords.xDir) {
            if (originCoords.xDir === "W") {
                xDelta = -xDelta;
            }
        }
        else {
            xDelta = otherCoords.x + originCoords.x + 1;
            if (originCoords.xDir === "E") {
                xDelta = -xDelta;
            }
        }
        let yDelta = otherCoords.y - originCoords.y;
        if (originCoords.yDir === otherCoords.yDir) {
            if (originCoords.yDir === "S") {
                yDelta = -yDelta;
            }
        }
        else {
            yDelta = otherCoords.y + originCoords.y + 1;
            if (originCoords.yDir === "N") {
                yDelta = -yDelta;
            }
        }
        return { x: xDelta, y: yDelta };
    }
    static findRelativeRoomDir(origin, otherRoom) {
        let coordDeltas = this.findRoomCoordDeltas(origin, otherRoom);
        if (Math.abs(coordDeltas.x) === Math.abs(coordDeltas.y)) {
            if (coordDeltas.x > 0) {
                if (coordDeltas.y > 0) {
                    return 2;
                }
                else {
                    return 4;
                }
            }
            else if (coordDeltas.x < 0) {
                if (coordDeltas.y > 0) {
                    return 8;
                }
                else {
                    return 6;
                }
            }
            else {
                // must be the same missionRoom, no direction
                return 0;
            }
        }
        else {
            if (Math.abs(coordDeltas.x) > Math.abs(coordDeltas.y)) {
                if (coordDeltas.x > 0) {
                    return 3;
                }
                else {
                    return 7;
                }
            }
            else {
                if (coordDeltas.y > 0) {
                    return 1;
                }
                else {
                    return 5;
                }
            }
        }
    }
    static negaDirection(dir) {
        switch (dir) {
            case "W":
                return "E";
            case "E":
                return "W";
            case "N":
                return "S";
            case "S":
                return "N";
        }
    }
    /**
     * Return missionRoom coordinates for a given Room, authored by tedivm
     * @param roomName
     * @returns {{x: (string|any), y: (string|any), x_dir: (string|any), y_dir: (string|any)}}
     */
    static getRoomCoordinates(roomName) {
        let coordinateRegex = /(E|W)(\d+)(N|S)(\d+)/g;
        let match = coordinateRegex.exec(roomName);
        if (!match)
            return;
        let xDir = match[1];
        let x = match[2];
        let yDir = match[3];
        let y = match[4];
        return {
            x: Number(x),
            y: Number(y),
            xDir: xDir,
            yDir: yDir,
        };
    }
    static roomTypeFromName(roomName) {
        let coords = this.getRoomCoordinates(roomName);
        if (coords.x % 10 === 0 || coords.y % 10 === 0) {
            return ROOMTYPE_ALLEY;
        }
        else if (coords.x % 5 === 0 && coords.y % 5 === 0) {
            return ROOMTYPE_CORE;
        }
        else if (coords.x % 10 === 6 || coords.x % 10 === 4 || coords.y % 10 === 6 || coords.y % 10 === 4) {
            return ROOMTYPE_SOURCEKEEPER;
        }
        else {
            return ROOMTYPE_CONTROLLER;
        }
    }
    static findNearestCore(roomName) {
        let roomCoords = this.getRoomCoordinates(roomName);
        let x = Math.floor(roomCoords.x / 10) + 5;
        let y = Math.floor(roomCoords.y / 10) + 5;
        return roomCoords.xDir + x + roomCoords.yDir + y;
    }
}
const ARTROOMS = {};
const TICK_FULL_REPORT = 0;
const ROOMTYPE_SOURCEKEEPER = -1301;
const ROOMTYPE_CORE = -1302;
const ROOMTYPE_CONTROLLER = -1303;
const ROOMTYPE_ALLEY = -1304;
const RADAR_INTERVAL = 10000;

class Diplomat {
    constructor() {
        if (!Memory.empire) {
            Memory.empire = {};
        }
        _.defaults(Memory.empire, {
            allies: ALLIES,
            foes: FOES,
            partners: TRADE_PARTNERS,
            safe: {},
            danger: {},
        });
        this.allies = Memory.empire.allies;
        this.foes = Memory.empire.foes;
        this.partners = Memory.empire.partners;
    }
    checkEnemy(username, roomName) {
        if (this.allies[username]) {
            return false;
        }
        // make note of non-ally, non-npc creeps
        if (username !== "Invader" && username !== "Source Keeper") {
            Diplomat.strangerDanger(username, roomName);
        }
        return true;
    }
    static strangerDanger(username, roomName) {
        if (!Memory.strangerDanger) {
            Memory.strangerDanger = {};
        }
        if (!Memory.strangerDanger[username]) {
            Memory.strangerDanger[username] = [];
        }
        let lastReport = _.last(Memory.strangerDanger[username]);
        if (!lastReport || lastReport.tickSeen < Game.time - 2000) {
            let report = { tickSeen: Game.time, roomName: roomName };
            console.log("STRANGER DANGER: one of", username, "\'s creeps seen in", roomName);
            Memory.strangerDanger[username].push(report);
            while (Memory.strangerDanger[username].length > 10)
                Memory.strangerDanger[username].shift();
        }
    }
}
const ALLIES = {
    "taiga": true,
    "Reini": true,
    "bonzaiferroni": true,
    "SteeleR": true,
    "Vervorris": true,
    "Jeb": true,
    "danny": true,
    "Atavus": true,
    "Ashburnie": true,
    "ricane": true,
    "trebbettes": true,
    "bovius": true,
};
const TRADE_PARTNERS = {
    "bonzaiferroni": true,
    "taiga": true,
    "Reini": true,
    "Vervorris": true,
    "Jeb": true,
    "trebbettes": true,
    "ricane": true,
};
const FOES = {};

class Empire {
    constructor() {
        if (!Memory.empire)
            Memory.empire = {};
        _.defaults(Memory.empire, {
            errantConstructionRooms: {},
        });
        this.memory = Memory.empire;
    }
    /**
     * Occurs before operation phases
     */
    init() {
        this.traveler = traveler;
        this.diplomat = new Diplomat();
        this.map = new WorldMap(this.diplomat);
        this.spawnGroups = this.map.init();
    }
    /**
     * Occurs after operation phases
     */
    actions() {
        this.map.actions();
        this.clearErrantConstruction();
    }
    getSpawnGroup(roomName) {
        if (this.spawnGroups[roomName]) {
            return this.spawnGroups[roomName];
        }
        else {
            let room = Game.rooms[roomName];
            if (room && room.find(FIND_MY_SPAWNS).length > 0 && room.controller.level > 0) {
                this.spawnGroups[roomName] = new SpawnGroup(room);
                return this.spawnGroups[roomName];
            }
        }
    }
    underCPULimit() {
        return Profiler.proportionUsed() < .9;
    }
    clearErrantConstruction() {
        if (Game.time % 1000 !== 0) {
            return;
        }
        let removeErrantStatus = {};
        let addErrantStatus = {};
        for (let siteName in Game.constructionSites) {
            let site = Game.constructionSites[siteName];
            if (site.room) {
                delete this.memory.errantConstructionRooms[site.pos.roomName];
            }
            else {
                if (this.memory.errantConstructionRooms[site.pos.roomName]) {
                    site.remove();
                    removeErrantStatus[site.pos.roomName];
                }
                else {
                    addErrantStatus[site.pos.roomName] = true;
                }
            }
        }
        for (let roomName in addErrantStatus) {
            this.memory.errantConstructionRooms[roomName] = true;
        }
        for (let roomName in removeErrantStatus) {
            notifier.log(`EMPIRE: removed construction sites in ${roomName}`);
            delete this.memory.errantConstructionRooms[roomName];
        }
    }
    spawnFromClosest(pos, body, name) {
        let closest;
        let bestDistance = Number.MAX_VALUE;
        for (let roomName in this.spawnGroups) {
            let distance = Game.map.getRoomLinearDistance(pos.roomName, roomName);
            if (distance < bestDistance) {
                bestDistance = distance;
                closest = this.spawnGroups[roomName];
            }
        }
        return closest.spawn(body, name);
    }
}

var helper = {
    getStoredAmount(target, resourceType) {
        if (target instanceof Creep) {
            return target.carry[resourceType];
        }
        else if (target.hasOwnProperty("store")) {
            return target.store[resourceType];
        }
        else if (resourceType === RESOURCE_ENERGY && target.hasOwnProperty("energy")) {
            return target.energy;
        }
    },
    getCapacity(target) {
        if (target instanceof Creep) {
            return target.carryCapacity;
        }
        else if (target.hasOwnProperty("store")) {
            return target.storeCapacity;
        }
        else if (target.hasOwnProperty("energyCapacity")) {
            return target.energyCapacity;
        }
    },
    isFull(target, resourceType) {
        if (target instanceof Creep) {
            return target.carry[resourceType] === target.carryCapacity;
        }
        else if (target.hasOwnProperty("store")) {
            return target.store[resourceType] === target.storeCapacity;
        }
        else if (resourceType === RESOURCE_ENERGY && target.hasOwnProperty("energy")) {
            return target.energy === target.energyCapacity;
        }
    },
    clampDirection(direction) {
        while (direction < 1)
            direction += 8;
        while (direction > 8)
            direction -= 8;
        return direction;
    },
    deserializeRoomPosition(roomPosition) {
        return new RoomPosition(roomPosition.x, roomPosition.y, roomPosition.roomName);
    },
    blockOffPosition(costs, roomObject, range, cost = 30) {
        for (let xDelta = -range; xDelta <= range; xDelta++) {
            for (let yDelta = -range; yDelta <= range; yDelta++) {
                if (Game.map.getTerrainAt(roomObject.pos.x + xDelta, roomObject.pos.y + yDelta, roomObject.room.name) === "wall")
                    continue;
                costs.set(roomObject.pos.x + xDelta, roomObject.pos.y + yDelta, cost);
            }
        }
    },
    addTerrainToMatrix(matrix, roomName) {
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                let terrain = Game.map.getTerrainAt(x, y, roomName);
                if (terrain === "wall") {
                    matrix.set(x, y, 0xff);
                }
                else if (terrain === "swamp") {
                    matrix.set(x, y, 5);
                }
                else {
                    matrix.set(x, y, 1);
                }
            }
        }
        return;
    },
    blockOffExits(matrix, cost = 0xff, roomName) {
        for (let x = 0; x < 50; x += 49) {
            for (let y = 0; y < 50; y++) {
                if (roomName) {
                    let terrain = Game.map.getTerrainAt(x, y, roomName);
                    if (terrain !== "wall") {
                        matrix.set(x, y, cost);
                    }
                }
                else {
                    matrix.set(x, y, 0xff);
                }
            }
        }
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y += 49) {
                if (roomName) {
                    let terrain = Game.map.getTerrainAt(x, y, roomName);
                    if (terrain !== "wall") {
                        matrix.set(x, y, cost);
                    }
                }
                else {
                    matrix.set(x, y, 0xff);
                }
            }
        }
        return matrix;
    },
    showMatrix(matrix) {
        // showMatrix
        for (let y = 0; y < 50; y++) {
            let line = "";
            for (let x = 0; x < 50; x++) {
                let value = matrix.get(x, y);
                if (value === 0xff)
                    line += "f";
                else
                    line += value % 10;
            }
            console.log(line);
        }
    },
    coordToPosition(coord, centerPosition, rotation = 0) {
        if (!(centerPosition instanceof RoomPosition)) {
            centerPosition = this.deserializeRoomPosition(centerPosition);
        }
        let xCoord = coord.x;
        let yCoord = coord.y;
        if (rotation === 1) {
            xCoord = -coord.y;
            yCoord = coord.x;
        }
        else if (rotation === 2) {
            xCoord = -coord.x;
            yCoord = -coord.y;
        }
        else if (rotation === 3) {
            xCoord = coord.y;
            yCoord = -coord.x;
        }
        return new RoomPosition(centerPosition.x + xCoord, centerPosition.y + yCoord, centerPosition.roomName);
    },
    positionToCoord(pos, centerPoint, rotation = 0) {
        let xCoord = pos.x - centerPoint.x;
        let yCoord = pos.y - centerPoint.y;
        if (rotation === 0) {
            return { x: xCoord, y: yCoord };
        }
        else if (rotation === 1) {
            return { x: yCoord, y: -xCoord };
        }
        else if (rotation === 2) {
            return { x: -xCoord, y: -yCoord };
        }
        else if (rotation === 3) {
            return { x: -yCoord, y: xCoord };
        }
    },
    serializePath(startPos, path) {
        let serializedPath = "";
        let lastPosition = startPos;
        for (let position of path) {
            if (position.roomName === lastPosition.roomName) {
                serializedPath += lastPosition.getDirectionTo(position);
            }
            lastPosition = position;
        }
        return serializedPath;
    },
    pathablePosition(roomName) {
        for (let radius = 0; radius < 20; radius++) {
            for (let xDelta = -radius; xDelta <= radius; xDelta++) {
                for (let yDelta = -radius; yDelta <= radius; yDelta++) {
                    if (Math.abs(yDelta) !== radius && Math.abs(xDelta) !== radius) {
                        continue;
                    }
                    let x = 25 + xDelta;
                    let y = 25 + yDelta;
                    let terrain = Game.map.getTerrainAt(x, y, roomName);
                    if (terrain !== "wall") {
                        return new RoomPosition(x, y, roomName);
                    }
                }
            }
        }
    },
    debugPath(path, identifier = "") {
        let count = 0;
        for (let position of path) {
            let room = Game.rooms[position.roomName];
            if (room) {
                let name = "debugPath" + identifier + count;
                count++;
                let flag = Game.flags[name];
                if (flag) {
                    flag.setPosition(position);
                }
                else {
                    position.createFlag(name, COLOR_ORANGE);
                }
            }
        }
        for (let i = count; i < 1000; i++) {
            let name = "debugPath" + identifier + i;
            let flag = Game.flags[name];
            if (flag) {
                flag.remove();
            }
            else {
                break;
            }
        }
        return `placed ${count} out of ${path.length} flags`;
    },
    towerDamageAtRange(range) {
        if (range <= TOWER_OPTIMAL_RANGE) {
            return TOWER_POWER_ATTACK;
        }
        if (range >= TOWER_FALLOFF_RANGE) {
            range = TOWER_FALLOFF_RANGE;
        }
        return TOWER_POWER_ATTACK - (TOWER_POWER_ATTACK * TOWER_FALLOFF *
            (range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
    },
    permutator(inputArr) {
        let result = [];
        const permute = (arr, m = []) => {
            if (arr.length === 0) {
                result.push(m);
            }
            else {
                for (let i = 0; i < arr.length; i++) {
                    let curr = arr.slice();
                    let next = curr.splice(i, 1);
                    permute(curr.slice(), m.concat(next));
                }
            }
        };
        permute(inputArr);
        return result;
    },
    randomInterval(interval) {
        return interval + Math.floor((Math.random() - .5) * interval * .2);
    }
};

class RoomHelper {
    static findClosest(origin, destinations, options = {}) {
        if (options.linearDistanceLimit === undefined) {
            options.linearDistanceLimit = 16; // pathfinder room search limit
        }
        if (options.margin === undefined) {
            options.margin = 0;
        }
        let totalCPU = Game.cpu.getUsed();
        let filtered = _(destinations)
            .filter(dest => Game.map.getRoomLinearDistance(origin.pos.roomName, dest.pos.roomName) <= options.linearDistanceLimit)
            .sortBy(dest => Game.map.getRoomLinearDistance(origin.pos.roomName, dest.pos.roomName))
            .value();
        let bestDestinations = [];
        let bestLinearDistance = Number.MAX_VALUE;
        let bestDistance = Number.MAX_VALUE;
        for (let dest of filtered) {
            let linearDistance = Game.map.getRoomLinearDistance(origin.pos.roomName, dest.pos.roomName);
            if (linearDistance > bestLinearDistance) {
                continue;
            }
            let distance;
            if (options.byRoute) {
                let route = empire.traveler.findRoute(origin.pos.roomName, dest.pos.roomName);
                if (!route) {
                    continue;
                }
                distance = Object.keys(route).length;
            }
            else {
                let ret = empire.traveler.findTravelPath(origin, dest, { maxOps: options.opsLimit });
                if (ret.incomplete) {
                    continue;
                }
                distance = ret.path.length;
            }
            if (distance < bestDistance) {
                bestLinearDistance = linearDistance;
                bestDistance = distance;
                bestDestinations = _.filter(bestDestinations, value => value.distance <= bestDistance + options.margin);
            }
            if (distance <= bestDistance + options.margin) {
                bestDestinations.push({ destination: dest, distance: distance });
            }
        }
        console.log(`FINDCLOSEST: cpu: ${Game.cpu.getUsed() - totalCPU}, # considered: ${destinations.length},` +
            ` # selected ${bestDestinations.length}`);
        return bestDestinations;
    }
}

class TimeoutTracker {
    static init() {
        if (Memory.timeoutTracker) {
            let data = Memory.timeoutTracker;
            notifier.log(`TIMEOUT: operation: ${data.operation}, mission: ${data.mission}, phase: ${data.phase}`);
            delete Memory.timeoutTracker;
        }
        Memory.timeoutTracker = { phase: "pre-operation init", operation: undefined, mission: undefined };
    }
    static log(phase, operation, mission) {
        Memory.timeoutTracker.operation = operation;
        Memory.timeoutTracker.mission = mission;
        Memory.timeoutTracker.phase = phase;
    }
    static finalize() {
        delete Memory.timeoutTracker;
    }
}

class Operation {
    /**
     *
     * @param flag - missions will operate relative to this flag, use the following naming convention: "operationType_operationName"
     * @param name - second part of flag.name, should be unique amont all other operation names (I use city names)
     * @param type - first part of flag.name, used to determine which operation class to instantiate
     * @param empire - object used for empire-scoped behavior (terminal transmission, etc.)
     */
    constructor(flag, name, type) {
        this.missions = {};
        this.flag = flag;
        this.name = name;
        this.type = type;
        this.room = flag.room;
        this.memory = flag.memory;
        if (!this.memory.spawnData) {
            this.memory.spawnData = {};
        }
        this.spawnData = this.memory.spawnData;
        // variables that require vision (null check where appropriate)
        if (this.flag.room) {
            this.hasVision = true;
            this.sources = _.sortBy(flag.room.find(FIND_SOURCES), (s) => s.pos.getRangeTo(flag));
            this.mineral = _.head(flag.room.find(FIND_MINERALS));
        }
    }
    /**
     * Init Phase - initialize operation variables and instantiate missions
     */
    init() {
        try {
            TimeoutTracker.log("initOperation", this.name);
            this.initOperation();
        }
        catch (e) {
            console.log("error caught in initOperation phase, operation:", this.name);
            console.log(e.stack);
        }
        for (let missionName in this.missions) {
            try {
                TimeoutTracker.log("initMission", this.name, missionName);
                Profiler.start("in_m." + missionName.substr(0, 3));
                this.missions[missionName].initMission();
                Profiler.end("in_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in initMission phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }
    }
    /**
     * RoleCall Phase - Iterate through missions and call mission.roleCall()
     */
    roleCall() {
        // mission roleCall
        for (let missionName in this.missions) {
            try {
                TimeoutTracker.log("roleCall", this.name, missionName);
                Profiler.start("rc_m." + missionName.substr(0, 3));
                this.missions[missionName].roleCall();
                Profiler.end("rc_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in roleCall phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }
    }
    /**
     * Action Phase - Iterate through missions and call mission.missionActions()
     */
    actions() {
        // mission actions
        for (let missionName in this.missions) {
            try {
                TimeoutTracker.log("actions", this.name, missionName);
                Profiler.start("ac_m." + missionName.substr(0, 3));
                this.missions[missionName].missionActions();
                Profiler.end("ac_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in missionActions phase, operation:", this.name, "mission:", missionName, "in missionRoom ", this.flag.pos.roomName);
                console.log(e.stack);
            }
        }
    }
    /**
     * Finalization Phase - Iterate through missions and call mission.finalizeMission(), also call operation.finalizeOperation()
     */
    finalize() {
        // mission actions
        for (let missionName in this.missions) {
            try {
                TimeoutTracker.log("finalize", this.name, missionName);
                Profiler.start("fi_m." + missionName.substr(0, 3));
                this.missions[missionName].finalizeMission();
                Profiler.end("fi_m." + missionName.substr(0, 3));
            }
            catch (e) {
                console.log("error caught in finalizeMission phase, operation:", this.name, "mission:", missionName);
                console.log(e.stack);
            }
        }
        try {
            TimeoutTracker.log("finalizeOperation", this.name);
            this.finalizeOperation();
            TimeoutTracker.log("post-operation");
        }
        catch (e) {
            console.log("error caught in finalizeOperation phase, operation:", this.name);
            console.log(e.stack);
        }
    }
    /**
     * Invalidate Cache Phase - Occurs every-so-often (see constants.ts) to give you an efficient means of invalidating operation and
     * mission cache
     */
    invalidateCache() {
        // base rate of 1 proc out of 100 ticks
        if (Math.random() < .01) {
            for (let missionName in this.missions) {
                try {
                    this.missions[missionName].invalidateMissionCache();
                }
                catch (e) {
                    console.log("error caught in invalidateMissionCache phase, operation:", this.name, "mission:", missionName);
                    console.log(e.stack);
                }
            }
            try {
                this.invalidateOperationCache();
            }
            catch (e) {
                console.log("error caught in invalidateOperationCache phase, operation:", this.name);
                console.log(e.stack);
            }
        }
    }
    /**
     * Add mission to operation.missions hash
     * @param mission
     */
    addMission(mission) {
        // it is important for every mission belonging to an operation to have
        // a unique name or they will be overwritten here
        this.missions[mission.name] = mission;
    }
    initRemoteSpawn(roomDistanceLimit, levelRequirement, margin = 0) {
        // invalidated periodically
        if (!this.spawnData.nextSpawnCheck || Game.time >= this.spawnData.nextSpawnCheck) {
            let spawnGroups = _.filter(_.toArray(empire.spawnGroups), spawnGroup => spawnGroup.room.controller.level >= levelRequirement
                && spawnGroup.room.name !== this.flag.pos.roomName);
            let bestGroups = RoomHelper.findClosest(this.flag, spawnGroups, { margin: margin, linearDistanceLimit: roomDistanceLimit });
            if (bestGroups.length > 0) {
                bestGroups = _.sortBy(bestGroups, value => value.distance);
                this.spawnData.spawnRooms = _.map(bestGroups, value => {
                    return { distance: value.distance, roomName: value.destination.room.name };
                });
                this.spawnData.nextSpawnCheck = Game.time + helper.randomInterval(10000); // Around 10 hours
            }
            else {
                this.spawnData.nextSpawnCheck = Game.time + 100; // Around 6 min
            }
            console.log(`SPAWN: finding spawn rooms in ${this.name}, result: ${bestGroups.length} found`);
        }
        if (this.spawnData.spawnRooms) {
            let bestAvailability = 0;
            let bestSpawn;
            for (let data of this.spawnData.spawnRooms) {
                let spawnGroup = empire.getSpawnGroup(data.roomName);
                if (!spawnGroup) {
                    continue;
                }
                if (spawnGroup.averageAvailability >= 1) {
                    bestSpawn = data;
                    break;
                }
                if (spawnGroup.averageAvailability > bestAvailability) {
                    bestAvailability = spawnGroup.averageAvailability;
                    bestSpawn = data;
                }
            }
            if (bestSpawn) {
                this.remoteSpawn = { distance: bestSpawn.distance, spawnGroup: empire.getSpawnGroup(bestSpawn.roomName) };
            }
        }
    }
    manualControllerBattery(id) {
        let object = Game.getObjectById(id);
        if (!object) {
            return "that is not a valid game object or not in vision";
        }
        this.flag.room.memory.controllerBatteryId = id;
        this.flag.room.memory.upgraderPositions = undefined;
        return "controller battery assigned to" + object;
    }
    findOperationWaypoints() {
        this.waypoints = [];
        for (let i = 0; i < 100; i++) {
            let flag = Game.flags[this.name + "_waypoints_" + i];
            if (flag) {
                this.waypoints.push(flag);
            }
            else {
                break;
            }
        }
    }
    setMax(missionName, max) {
        if (!this.memory[missionName])
            return "SPAWN: no " + missionName + " mission in " + this.name;
        let oldValue = this.memory[missionName].max;
        this.memory[missionName].max = max;
        return "SPAWN: " + missionName + " max spawn value changed from " + oldValue + " to " + max;
    }
    setBoost(missionName, activateBoost) {
        if (!this.memory[missionName])
            return "SPAWN: no " + missionName + " mission in " + this.name;
        let oldValue = this.memory[missionName].activateBoost;
        this.memory[missionName].activateBoost = activateBoost;
        return "SPAWN: " + missionName + " boost value changed from " + oldValue + " to " + activateBoost;
    }
}

// these are the constants that govern your energy balance
// rooms below this will try to pull energy...
const NEED_ENERGY_THRESHOLD = 200000;
// ...from rooms above this.
const SUPPLY_ENERGY_THRESHOLD = 250000;
const CACHE_INVALIDATION_FREQUENCY = 1000;
const CACHE_INVALIDATION_PERIOD = 10;
const MAX_HARVEST_DISTANCE = 2;
const MAX_HARVEST_PATH = 165;
const PRIORITY_BUILD = [
    STRUCTURE_SPAWN,
    STRUCTURE_TOWER,
    STRUCTURE_EXTENSION,
    STRUCTURE_ROAD,
    STRUCTURE_CONTAINER,
    STRUCTURE_LINK,
    STRUCTURE_STORAGE
];
const LOADAMOUNT_MINERAL = Math.ceil(33 / 6);
const USERNAME = _.first(_.toArray(Game.structures)).owner.username;
var OperationPriority;
(function (OperationPriority) {
    OperationPriority[OperationPriority["Emergency"] = 0] = "Emergency";
    OperationPriority[OperationPriority["OwnedRoom"] = 1] = "OwnedRoom";
    OperationPriority[OperationPriority["VeryHigh"] = 2] = "VeryHigh";
    OperationPriority[OperationPriority["High"] = 3] = "High";
    OperationPriority[OperationPriority["Medium"] = 4] = "Medium";
    OperationPriority[OperationPriority["Low"] = 5] = "Low";
    OperationPriority[OperationPriority["VeryLow"] = 6] = "VeryLow";
})(OperationPriority || (OperationPriority = {}));
var Direction;
(function (Direction) {
    Direction[Direction["North"] = 1] = "North";
    Direction[Direction["NorthEast"] = 2] = "NorthEast";
    Direction[Direction["East"] = 3] = "East";
    Direction[Direction["SouthEast"] = 4] = "SouthEast";
    Direction[Direction["South"] = 5] = "South";
    Direction[Direction["SouthWest"] = 6] = "SouthWest";
    Direction[Direction["West"] = 7] = "West";
    Direction[Direction["NorthWest"] = 8] = "NorthWest";
})(Direction || (Direction = {}));
const IGOR_CAPACITY = 1000;

class Agent {
    constructor(creep, mission) {
        this.creep = creep;
        this.mission = mission;
        this.room = creep.room;
        this.missionRoom = mission.room;
        this.memory = creep.memory;
        this.pos = creep.pos;
        this.carry = creep.carry;
        this.carryCapacity = creep.carryCapacity;
        this.hits = creep.hits;
        this.hitsMax = creep.hitsMax;
        this.ticksToLive = creep.ticksToLive;
        this.name = creep.name;
        this.id = creep.id;
        this.fatigue = creep.fatigue;
        this.spawning = creep.spawning;
    }
    attack(target) { return this.creep.attack(target); }
    attackController(controller) { return this.creep.attackController(controller); }
    build(target) { return this.creep.build(target); }
    claimController(controller) { return this.creep.claimController(controller); }
    dismantle(target) { return this.creep.dismantle(target); }
    drop(resourceType, amount) { return this.creep.drop(resourceType, amount); }
    getActiveBodyparts(type) { return this.creep.getActiveBodyparts(type); }
    harvest(source) { return this.creep.harvest(source); }
    move(direction) { return this.creep.move(direction); }
    pickup(resource) { return this.creep.pickup(resource); }
    rangedAttack(target) { return this.creep.rangedAttack(target); }
    rangedMassAttack() { return this.creep.rangedMassAttack(); }
    repair(target) { return this.creep.repair(target); }
    reserveController(controller) { return this.creep.reserveController(controller); }
    say(message, pub) { return this.creep.say(message, pub); }
    suicide() { return this.creep.suicide(); }
    upgradeController(controller) { return this.creep.upgradeController(controller); }
    heal(target) {
        if (target instanceof Agent) {
            return this.creep.heal(target.creep);
        }
        else {
            return this.creep.heal(target);
        }
    }
    rangedHeal(target) {
        if (target instanceof Agent) {
            return this.creep.rangedHeal(target.creep);
        }
        else {
            return this.creep.rangedHeal(target);
        }
    }
    transfer(target, resourceType, amount) {
        return this.creep.transfer(target, resourceType, amount);
    }
    withdraw(target, resourceType, amount) {
        if (target instanceof Creep) {
            return target.transfer(this.creep, resourceType, amount);
        }
        else {
            return this.creep.withdraw(target, resourceType, amount);
        }
    }
    partCount(partType) { return this.partCount(partType); }
    travelTo(destination, options) {
        if (destination instanceof RoomPosition) {
            destination = { pos: destination };
        }
        return empire.traveler.travelTo(this.creep, destination, options);
    }
    isFull(margin = 0) {
        return _.sum(this.carry) >= this.carryCapacity - margin;
    }
    travelToAndBuild(site) {
        this.idleNear(site);
        return this.build(site);
    }
    retrieve(target, resourceType, options, amount) {
        if (this.pos.isNearTo(target)) {
            this.withdraw(target, resourceType, amount);
        }
        else {
            this.travelTo(target, options);
            return ERR_NOT_IN_RANGE;
        }
    }
    deliver(target, resourceType, options, amount) {
        if (this.pos.isNearTo(target)) {
            return this.transfer(target, resourceType, amount);
        }
        else {
            this.travelTo(target, options);
            return ERR_NOT_IN_RANGE;
        }
    }
    hasLoad() {
        if (this.carryCapacity === 0)
            return false;
        if (this.memory.hasLoad && _.sum(this.carry) === 0) {
            this.memory.hasLoad = false;
        }
        else if (!this.memory.hasLoad && _.sum(this.carry) === this.carryCapacity) {
            this.memory.hasLoad = true;
        }
        return this.memory.hasLoad;
    }
    /**
     * Can be used to keep idling creeps out of the way, like when a road repairer doesn't have any roads needing repair
     * or a spawn refiller who currently has full extensions.
     * @param anchor
     * @param maintainDistance
     * @returns {any}
     */
    idleOffRoad(anchor = this.mission.flag, maintainDistance = false) {
        let offRoad = this.pos.lookForStructure(STRUCTURE_ROAD) === undefined;
        if (offRoad)
            return OK;
        let positions = _.sortBy(this.pos.openAdjacentSpots(), (p) => p.getRangeTo(anchor));
        if (maintainDistance) {
            let currentRange = this.pos.getRangeTo(anchor);
            positions = _.filter(positions, (p) => p.getRangeTo(anchor) <= currentRange);
        }
        let swampPosition;
        for (let position of positions) {
            if (position.lookForStructure(STRUCTURE_ROAD))
                continue;
            let terrain = position.lookFor(LOOK_TERRAIN)[0];
            if (terrain === "swamp") {
                swampPosition = position;
            }
            else {
                return this.move(this.pos.getDirectionTo(position));
            }
        }
        if (swampPosition) {
            return this.move(this.pos.getDirectionTo(swampPosition));
        }
        return this.travelTo(anchor);
    }
    stealNearby(stealSource) {
        if (stealSource === "creep") {
            let creep = _(this.pos.findInRange(FIND_MY_CREEPS, 1))
                .filter((c) => c.getActiveBodyparts(WORK) === 0 && c.carry.energy > 0)
                .head();
            if (!creep) {
                return ERR_NOT_IN_RANGE;
            }
            return creep.transfer(this.creep, RESOURCE_ENERGY);
        }
        else {
            let structure = _(this.pos.findInRange(this.creep.room.findStructures(stealSource), 1))
                .filter((s) => s.energy > 0)
                .head();
            if (!structure) {
                return ERR_NOT_IN_RANGE;
            }
            return this.withdraw(structure, RESOURCE_ENERGY);
        }
    }
    idleNear(place, acceptableRange = 1, cachePos = false, allowSwamp = true) {
        let range = this.pos.getRangeTo(place);
        if (range <= acceptableRange && !this.pos.lookForStructure(STRUCTURE_ROAD)) {
            return;
        }
        if (range <= acceptableRange + 1) {
            let swampDirection;
            // find movement options
            let direction = this.creep.pos.getDirectionTo(place);
            for (let i = -2; i <= 2; i++) {
                let relDirection = direction + i;
                relDirection = helper.clampDirection(relDirection);
                let position = this.creep.pos.getPositionAtDirection(relDirection);
                if (!position.inRangeTo(place, acceptableRange))
                    continue;
                if (position.lookForStructure(STRUCTURE_ROAD))
                    continue;
                if (!position.isPassible())
                    continue;
                if (position.isNearExit(0))
                    continue;
                if (position.lookFor(LOOK_TERRAIN)[0] === "swamp") {
                    swampDirection = relDirection;
                    continue;
                }
                return this.creep.move(relDirection);
            }
            if (swampDirection && allowSwamp) {
                return this.creep.move(swampDirection);
            }
        }
        if (cachePos) {
            return this.travelTo(this.cacheIdlePosition(place, acceptableRange));
        }
        if (range <= 1) {
            let position = this.findIdlePosition(place, acceptableRange);
            if (!position) {
                return;
            }
            return this.travelTo({ pos: position });
        }
        return this.travelTo(place);
    }
    cacheIdlePosition(place, acceptableRange) {
        if (this.memory.idlePosition) {
            let position = helper.deserializeRoomPosition(this.memory.idlePosition);
            let range = position.getRangeTo(place);
            if (range === 0) {
                return position;
            }
            if (range <= acceptableRange && position.isPassible()) {
                return position;
            }
            else {
                this.memory.idlePosition = undefined;
                return this.cacheIdlePosition(place, acceptableRange);
            }
        }
        else {
            let position = this.findIdlePosition(place, acceptableRange);
            if (position) {
                this.memory.idlePosition = position;
                return position;
            }
            else {
                this.memory.idlePosition = place.pos;
                console.log(`AGENT: no idlepos within range ${acceptableRange} near ${place.pos}`);
                return place.pos;
            }
        }
    }
    findIdlePosition(place, acceptableRange) {
        let radius = 0;
        let validPositions = [];
        while (radius <= acceptableRange) {
            for (let xDelta = -radius; xDelta <= radius; xDelta++) {
                for (let yDelta = -radius; yDelta <= radius; yDelta++) {
                    if (Math.abs(xDelta) < radius && Math.abs(yDelta) < radius) {
                        continue;
                    }
                    let x = place.pos.x + xDelta;
                    let y = place.pos.y + yDelta;
                    let position = new RoomPosition(x, y, place.pos.roomName);
                    if (!position.isPassible()) {
                        continue;
                    }
                    if (position.isNearExit(0)) {
                        continue;
                    }
                    if (position.lookForStructure(STRUCTURE_ROAD)) {
                        continue;
                    }
                    validPositions.push(position);
                }
            }
            radius++;
        }
        return this.pos.findClosestByRange(validPositions);
    }
    isNearTo(place) {
        return this.pos.isNearTo(place);
    }
    seekBoost(boosts, allowUnboosted) {
        if (!boosts)
            return true;
        if (this.room.findStructures(STRUCTURE_LAB).length === 0)
            return true;
        if (this.room.controller.level < 6)
            return true;
        let boosted = true;
        for (let boost of boosts) {
            if (this.memory[boost])
                continue;
            let requests = this.room.memory.boostRequests;
            if (!requests) {
                this.memory[boost] = true;
                continue;
            }
            if (!requests[boost]) {
                requests[boost] = { flagName: undefined, requesterIds: [] };
            }
            // check if already boosted
            let boostedPart = _.find(this.creep.body, { boost: boost });
            if (boostedPart) {
                this.memory[boost] = true;
                requests[boost].requesterIds = _.pull(requests[boost].requesterIds, this.creep.id);
                continue;
            }
            boosted = false;
            if (!_.includes(requests[boost].requesterIds, this.creep.id)) {
                requests[boost].requesterIds.push(this.creep.id);
            }
            if (this.creep.spawning)
                continue;
            let flag = Game.flags[requests[boost].flagName];
            if (!flag)
                continue;
            let lab = flag.pos.lookForStructure(STRUCTURE_LAB);
            if (lab.mineralType === boost && lab.mineralAmount >= IGOR_CAPACITY && lab.energy >= IGOR_CAPACITY) {
                if (this.pos.isNearTo(lab)) {
                    lab.boostCreep(this.creep);
                }
                else {
                    this.travelTo(lab);
                    return false;
                }
            }
            else if (allowUnboosted) {
                console.log("BOOST: no boost for", this.creep.name, " so moving on (allowUnboosted = true)");
                requests[boost].requesterIds = _.pull(requests[boost].requesterIds, this.creep.id);
                this.memory[boost] = true;
            }
            else {
                if (Game.time % 10 === 0)
                    console.log("BOOST: no boost for", this.creep.name, " it will wait for some boost (allowUnboosted = false)");
                this.idleOffRoad(this.missionRoom.storage);
                return false;
            }
        }
        return boosted;
    }
    avoidSK(destination) {
        let costCall = (roomName, matrix) => {
            if (roomName !== this.pos.roomName)
                return;
            let room = Game.rooms[this.pos.roomName];
            let sourceKeepers = _.filter(room.hostiles, (c) => c.owner.username === "Source Keeper");
            for (let sourceKeeper of sourceKeepers) {
                const SAFE_RANGE = 4;
                if (this.pos.getRangeTo(sourceKeeper) < SAFE_RANGE)
                    continue;
                for (let xDelta = -SAFE_RANGE; xDelta <= SAFE_RANGE; xDelta++) {
                    for (let yDelta = -SAFE_RANGE; yDelta <= SAFE_RANGE; yDelta++) {
                        matrix.set(sourceKeeper.pos.x + xDelta, sourceKeeper.pos.y + yDelta, 0xff);
                    }
                }
            }
            return matrix;
        };
        let options = {};
        if (this.room.roomType === ROOMTYPE_SOURCEKEEPER) {
            options.roomCallback = costCall;
            let hostileCount = this.creep.room.hostiles.length;
            if (!this.memory.hostileCount)
                this.memory.hostileCount = 0;
            if (hostileCount > this.memory.hostileCount) {
                this.resetTravelPath();
            }
            this.memory.hostileCount = hostileCount;
        }
        return this.travelTo(destination, options);
    }
    resetTravelPath() {
        if (!this.memory._travel)
            return;
        delete this.memory._travel.path;
    }
    resetPrep() {
        this.memory.prep = false;
    }
    fleeHostiles() {
        return this.fleeByPath(this.room.fleeObjects, 6, 2, false);
    }
    fleeByPath(fleeObjects, fleeRange, fleeDelay, confineToRoom = false) {
        let closest = this.pos.findClosestByRange(fleeObjects);
        let rangeToClosest = 50;
        if (closest) {
            rangeToClosest = this.pos.getRangeTo(closest);
        }
        if (rangeToClosest > fleeRange) {
            if (!this.memory._flee) {
                return false; // where most creeps exit function
            }
            let fleeData = this.memory._flee;
            if (this.pos.isNearExit(0)) {
                this.moveOffExit();
                return true;
            }
            if (fleeData.delay <= 0) {
                delete this.memory._flee;
                return false; // safe to resume
            }
            fleeData.delay--;
            return true;
        }
        if (this.fatigue > 0) {
            if (closest instanceof Creep) {
                let moveCount = this.getActiveBodyparts(MOVE);
                let dropAmount = this.carry.energy - (moveCount * CARRY_CAPACITY);
                this.drop(RESOURCE_ENERGY, dropAmount);
            }
            return true;
        }
        if (!this.memory._flee) {
            this.memory._flee = {};
        }
        let fleeData = this.memory._flee;
        fleeData.delay = fleeDelay;
        if (fleeData.nextPos) {
            let position = helper.deserializeRoomPosition(fleeData.nextPos);
            if (this.arrivedAtPosition(position)) {
                fleeData.path = fleeData.path.substr(1);
            }
            else {
                fleeData.path = undefined;
            }
        }
        if (fleeData.path) {
            if (fleeData.path.length > 0) {
                let nextDirection = parseInt(fleeData.path[0], 10);
                let position = this.pos.getPositionAtDirection(nextDirection);
                if (!position.isNearExit(0) &&
                    position.findClosestByRange(fleeObjects).pos.getRangeTo(position) < rangeToClosest) {
                    fleeData.path = undefined;
                }
                else {
                    this.move(nextDirection);
                    fleeData.nextPos = position;
                    return true;
                }
            }
            else {
                fleeData.path = undefined;
            }
        }
        if (!fleeData.path) {
            let avoidance = _.map(fleeObjects, obj => { return { pos: obj.pos, range: 10 }; });
            let ret = PathFinder.search(this.pos, avoidance, {
                flee: true,
                maxRooms: confineToRoom ? 1 : undefined,
                roomCallback: (roomName) => {
                    if (Traveler.checkOccupied(roomName)) {
                        return false;
                    }
                    if (roomName === this.room.name) {
                        return empire.traveler.getCreepMatrix(this.room);
                    }
                    if (Game.rooms[roomName]) {
                        return empire.traveler.getStructureMatrix(Game.rooms[roomName]);
                    }
                }
            });
            if (ret.path.length === 0) {
                return true;
            }
            fleeData.path = Traveler.serializePath(this.pos, ret.path);
        }
        let nextDirection = parseInt(fleeData.path[0], 10);
        fleeData.nextPos = this.pos.getPositionAtDirection(nextDirection);
        this.move(nextDirection);
        return true;
    }
    retreat(avoidObjects, fleeRange = 5) {
        if (!avoidObjects) {
            avoidObjects = this.room.fleeObjects;
        }
        let avoidance = _.map(this.pos.findInRange(avoidObjects, fleeRange + 1), (c) => { return { pos: c.pos, range: 20 }; });
        let ret = PathFinder.search(this.pos, avoidance, {
            flee: true,
            roomCallback: (roomName) => {
                if (Traveler.checkOccupied(roomName)) {
                    return false;
                }
                if (roomName === this.room.name) {
                    return empire.traveler.getCreepMatrix(this.room);
                }
                if (Game.rooms[roomName]) {
                    return empire.traveler.getStructureMatrix(Game.rooms[roomName]);
                }
            }
        });
        if (ret.path.length > 0) {
            return this.creep.move(this.pos.getDirectionTo(ret.path[0]));
        }
        else {
            return OK;
        }
    }
    /**
     * Moves a creep to a position using creep.blindMoveTo(position), when at range === 1 will remove any occuping creep
     * @param position
     * @param name - if given, will suicide the occupying creep if string occurs anywhere in name (allows easy role replacement)
     * and will transfer any resources in creeps' carry
     * @param lethal - will suicide the occupying creep
     * @returns {number}
     */
    moveItOrLoseIt(position, name, lethal = true) {
        if (this.creep.fatigue > 0) {
            return OK;
        }
        let range = this.pos.getRangeTo(position);
        if (range === 0)
            return OK;
        if (range > 1) {
            return this.travelTo(position);
        }
        // take care of creep that might be in the way
        let occupier = _.head(position.lookFor(LOOK_CREEPS));
        if (occupier && occupier.name) {
            if (name && occupier.name.indexOf(name) >= 0) {
                if (lethal) {
                    for (let resourceType in occupier.carry) {
                        let amount = occupier.carry[resourceType];
                        if (amount > 0) {
                            occupier.transfer(this.creep, resourceType);
                        }
                    }
                    this.creep.say("my spot!");
                    occupier.suicide();
                }
            }
            else {
                let direction = occupier.pos.getDirectionTo(this);
                occupier.move(direction);
                this.creep.say("move it");
            }
        }
        // move
        let direction = this.pos.getDirectionTo(position);
        this.creep.move(direction);
    }
    /**
     * another function for keeping roads clear, this one is more useful for builders and road repairers that are
     * currently working, will move off road without going out of range of target
     * @param target - target for which you do not want to move out of range
     * @param allowSwamps
     * @returns {number}
     */
    yieldRoad(target, allowSwamps = true) {
        let isOffRoad = this.pos.lookForStructure(STRUCTURE_ROAD) === undefined;
        if (isOffRoad)
            return OK;
        let swampPosition;
        // find movement options
        let direction = this.pos.getDirectionTo(target);
        for (let i = -2; i <= 2; i++) {
            let relDirection = direction + i;
            relDirection = helper.clampDirection(relDirection);
            let position = this.pos.getPositionAtDirection(relDirection);
            if (!position.inRangeTo(target, 3))
                continue;
            if (position.lookFor(LOOK_STRUCTURES).length > 0)
                continue;
            if (!position.isPassible())
                continue;
            if (position.isNearExit(0))
                continue;
            if (position.lookFor(LOOK_TERRAIN)[0] === "swamp") {
                swampPosition = position;
                continue;
            }
            return this.move(relDirection);
        }
        if (swampPosition && allowSwamps) {
            return this.move(this.pos.getDirectionTo(swampPosition));
        }
        return this.travelTo(target);
    }
    ;
    /**
     * Only withdraw from a store-holder if there is enough resource to transfer (or if holder is full), cpu-efficiency effort
     * @param target
     * @param resourceType
     * @returns {number}
     */
    withdrawIfFull(target, resourceType) {
        if (!this.pos.isNearTo(target)) {
            return ERR_NOT_IN_RANGE;
        }
        let norm = Agent.normalizeStore(target);
        let storageAvailable = this.carryCapacity - _.sum(this.carry);
        let targetStorageAvailable = norm.storeCapacity - _.sum(norm.store);
        if (norm.store[resourceType] >= storageAvailable || targetStorageAvailable === 0) {
            return this.withdraw(target, resourceType);
        }
        else {
            return ERR_NOT_ENOUGH_RESOURCES;
        }
    }
    ;
    static normalizeStore(target) {
        let store;
        let storeCapacity;
        if (target instanceof Creep) {
            store = target.carry;
            storeCapacity = target.carryCapacity;
        }
        else {
            store = target.store;
            storeCapacity = target.storeCapacity;
        }
        return { store: store, storeCapacity: storeCapacity };
    }
    withdrawEverything(target) {
        let norm = Agent.normalizeStore(target);
        for (let resourceType in norm.store) {
            let amount = norm.store[resourceType];
            if (amount > 0) {
                return this.withdraw(target, resourceType);
            }
        }
        return ERR_NOT_ENOUGH_RESOURCES;
    }
    ;
    transferEverything(target) {
        for (let resourceType in this.carry) {
            let amount = this.carry[resourceType];
            if (amount > 0) {
                return this.transfer(target, resourceType);
            }
        }
        return ERR_NOT_ENOUGH_RESOURCES;
    }
    ;
    /**
     * Find a structure, cache, and invalidate cache based on the functions provided
     * @param findStructure
     * @param forget
     * @param immediate
     * @param prop
     * @returns {Structure}
     */
    rememberStructure(findStructure, forget, prop = "remStructureId", immediate = false) {
        if (this.memory[prop]) {
            let structure = Game.getObjectById(this.memory[prop]);
            if (structure && !forget(structure)) {
                return structure;
            }
            else {
                this.memory[prop] = undefined;
                return this.rememberStructure(findStructure, forget, prop, true);
            }
        }
        else if (Game.time % 10 === 0 || immediate) {
            let object = findStructure();
            if (object) {
                this.memory[prop] = object.id;
                return object;
            }
        }
    }
    ;
    /**
     * Find a creep, cache, and invalidate cache based on the functions provided
     * @param findCreep
     * @param forget
     * @returns {Structure}
     */
    rememberCreep(findCreep, forget) {
        if (this.memory.remCreepId) {
            let creep = Game.getObjectById(this.memory.remCreepId);
            if (creep && !forget(creep)) {
                return creep;
            }
            else {
                this.memory.remCreepId = undefined;
                return this.rememberCreep(findCreep, forget);
            }
        }
        else {
            let object = findCreep();
            if (object) {
                this.memory.remCreepId = object.id;
                return object;
            }
        }
    }
    ;
    /**
     * Find the nearest energy source with greater than 50 energy, cache with creep memory;
     * @returns {Creep | StructureContainer}
     */
    rememberBattery() {
        if (this.memory.batteryId) {
            let battery = Game.getObjectById(this.memory.batteryId);
            if (battery && Agent.normalizeStore(battery).store.energy >= 50) {
                return battery;
            }
            else {
                this.memory.batteryId = undefined;
                return this.rememberBattery();
            }
        }
        else {
            let battery = this.room.getAltBattery(this.creep);
            if (battery) {
                this.memory.batteryId = battery.id;
                return battery;
            }
        }
    }
    ;
    /**
     * Pass in position of recycle bin (aka container next to spawn) and will creep go recycle itself there
     * @param container
     */
    recycleSelf(container) {
        if (!container) {
            console.log(this.name, " needs a container to recycle self");
            return;
        }
        let binTooFull = (this.ticksToLive + _.sum(container.store)) > container.storeCapacity;
        if (binTooFull) {
            console.log(this.name, " is waiting for space in recycle bin in ", this.pos.roomName);
            return;
        }
        if (!this.pos.isEqualTo(container.pos)) {
            this.travelTo(container, { range: 0 });
            console.log(this.name, " is heading to recycle bin");
            return;
        }
        let spawn = this.pos.findClosestByRange(FIND_MY_SPAWNS);
        if (!spawn) {
            console.log("recycleBin is missing spawn in", this.room.name);
            return;
        }
        let recycleOutcome = spawn.recycleCreep(this.creep);
        if (recycleOutcome === OK) {
            console.log(this.pos.roomName, " recycled creep ", this.name);
        }
        else if (recycleOutcome === -9) {
            console.log(this.name, " is moving to recycle bin at ", container.pos);
            this.travelTo(container, { range: 0 });
            return;
        }
        else {
            console.log(this.room.name, " recycling error: ", recycleOutcome);
        }
        return;
    }
    ;
    /**
     * General-purpose energy getting, will look for an energy source in the same missionRoom as the operation flag (not creep)
     * @param creep
     * @param nextDestination
     * @param highPriority - allows you to withdraw energy before a battery reaches an optimal amount of energy, jumping
     * ahead of any other creeps trying to get energy
     * @param getFromSource
     */
    procureEnergy(nextDestination, highPriority = false, getFromSource = false) {
        let battery = this.getBattery();
        if (battery) {
            if (this.pos.isNearTo(battery)) {
                let outcome;
                if (highPriority) {
                    if (Agent.normalizeStore(battery).store.energy >= 50) {
                        outcome = this.withdraw(battery, RESOURCE_ENERGY);
                    }
                }
                else {
                    outcome = this.withdrawIfFull(battery, RESOURCE_ENERGY);
                }
                if (outcome === OK) {
                    this.memory.batteryId = undefined;
                    if (nextDestination) {
                        this.travelTo(nextDestination);
                    }
                }
            }
            else {
                this.travelTo(battery);
            }
        }
        else {
            if (getFromSource) {
                let closest = this.pos.findClosestByRange(this.mission.sources);
                if (closest) {
                    if (this.pos.isNearTo(closest)) {
                        this.harvest(closest);
                    }
                    else {
                        this.travelTo(closest);
                    }
                }
                else {
                    this.idleOffRoad();
                }
            }
            else {
                if (this.memory._travel && this.memory._travel.dest) {
                    let destPos = this.memory._travel.dest;
                    let dest = new RoomPosition(destPos.x, destPos.y, destPos.roomName);
                    this.idleOffRoad({ pos: dest }, true);
                }
                else {
                    this.idleOffRoad();
                }
            }
        }
    }
    nextPositionInPath() {
        if (this.memory._travel && this.memory._travel.path && this.memory._travel.path.length > 0) {
            let position = this.pos.getPositionAtDirection(parseInt(this.memory._travel.path[0], 10));
            if (!position.isNearExit(0)) {
                return position;
            }
        }
    }
    /**
     * Will return storage if it is available, otherwise will look for an alternative battery and cache it
     * @param creep - return a battery relative to the missionRoom that the creep is currently in
     * @returns {any}
     */
    getBattery() {
        let minEnergy = this.carryCapacity - this.carry.energy;
        if (this.room.storage && this.room.storage.store.energy > minEnergy) {
            return this.room.storage;
        }
        return this.rememberBattery();
    }
    static squadTravel(leader, follower, target, options) {
        if (leader.room !== follower.room) {
            if (leader.pos.isNearExit(0)) {
                leader.travelTo(target);
            }
            follower.travelTo(leader);
            return;
        }
        let range = leader.pos.getRangeTo(follower);
        if (range > 1) {
            follower.travelTo(leader);
            // attacker stands still
        }
        else if (follower.fatigue === 0) {
            leader.travelTo(target, options);
            follower.move(follower.pos.getDirectionTo(leader));
        }
    }
    capacityAvailable(container) {
        let norm = Agent.normalizeStore(container);
        return _.sum(this.carry) <= norm.storeCapacity - _.sum(norm.store);
    }
    standardHealing(agents) {
        let hurtAgents = _(this.pos.findInRange(agents, 3))
            .filter(agent => agent.hits < agent.hitsMax)
            .sortBy(agent => agent.hits - agent.hitsMax)
            .value();
        if (hurtAgents.length > 0) {
            let healPotential = this.getActiveBodyparts(HEAL) * 12;
            if (_.find(this.creep.body, part => part.boost)) {
                healPotential *= 4;
            }
            let mostHurt = _.head(hurtAgents);
            if (mostHurt.pos.isNearTo(this)) {
                this.heal(mostHurt);
                return true;
            }
            let nearbyAndHurt = _.filter(this.pos.findInRange(hurtAgents, 1), agent => agent.hits < agent.hitsMax - healPotential);
            if (nearbyAndHurt.length > 0) {
                this.heal(_.head(nearbyAndHurt));
                return true;
            }
            this.rangedHeal(_.head(hurtAgents));
            return true;
        }
        else {
            return false;
        }
    }
    standardRangedAttack() {
        let hostilesInRange = _(this.pos.findInRange(FIND_HOSTILE_CREEPS, 3))
            .sortBy(creep => creep.hits - creep.hitsMax)
            .value();
        if (hostilesInRange.length > 0) {
            if (hostilesInRange.length > 2 || this.pos.findClosestByRange(hostilesInRange).pos.isNearTo(this)) {
                this.rangedMassAttack();
                return hostilesInRange[0];
            }
            else {
                this.rangedAttack(hostilesInRange[0]);
                return hostilesInRange[0];
            }
        }
    }
    standardMelee(damageThreshold = 0) {
        if (this.hits < damageThreshold) {
            return;
        }
        let hostilesInRange = _(this.pos.findInRange(FIND_HOSTILE_CREEPS, 1))
            .sortBy(creep => creep.hits - creep.hitsMax)
            .value();
        if (hostilesInRange.length > 0) {
            this.attack(hostilesInRange[0]);
            return hostilesInRange[0];
        }
    }
    moveOffExit() {
        let swampDirection;
        for (let direction = 1; direction < 8; direction++) {
            let position = this.pos.getPositionAtDirection(direction);
            if (position.isNearExit(0)) {
                continue;
            }
            if (!position.isPassible()) {
                continue;
            }
            let terrain = position.lookFor(LOOK_TERRAIN)[0];
            if (terrain === "swamp") {
                swampDirection = direction;
                continue;
            }
            return this.move(direction);
        }
        if (swampDirection) {
            return this.move(swampDirection);
        }
        return ERR_NO_PATH;
    }
    arrivedAtPosition(position) {
        if (this.pos.getRangeTo(position) === 0) {
            return true;
        }
        if (this.pos.isNearExit(0) && position.isNearExit(0)) {
            return true;
        }
        return false;
    }
    isStuck() {
        return this.memory._travel && this.memory._travel.stuck >= 2;
    }
    pushyTravelTo(destination, exclusion, options = {}) {
        if (this.isStuck()) {
            options.returnData = { nextPos: undefined };
            this.travelTo(destination, options);
            if (options.returnData.nextPos) {
                let creep = options.returnData.nextPos.lookFor(LOOK_CREEPS)[0];
                if (creep && creep.my && (!exclusion || creep.name.indexOf(exclusion) < 0)) {
                    notifier.log(`pushed creep ${creep.pos}`);
                    this.say("excuse me", true);
                    creep.move(creep.pos.getDirectionTo(this));
                }
            }
        }
        else {
            this.travelTo(destination, options);
        }
    }
}

class Mission {
    constructor(operation, name, allowSpawn = true) {
        this.partnerPairing = {};
        this.name = name;
        this.flag = operation.flag;
        this.room = operation.room;
        this.spawnGroup = operation.spawnGroup;
        this.sources = operation.sources;
        if (!operation.memory[name])
            operation.memory[name] = {};
        this.memory = operation.memory[name];
        this.allowSpawn = allowSpawn;
        this.operation = operation;
        if (this.room)
            this.hasVision = true;
        // initialize memory to be used by this mission
        if (!this.memory.hc)
            this.memory.hc = {};
        if (operation.waypoints && operation.waypoints.length > 0) {
            this.waypoints = operation.waypoints;
        }
    }
    setBoost(activateBoost) {
        let oldValue = this.memory.activateBoost;
        this.memory.activateBoost = activateBoost;
        return `changing boost activation for ${this.name} in ${this.operation.name} from ${oldValue} to ${activateBoost}`;
    }
    setMax(max) {
        let oldValue = this.memory.max;
        this.memory.max = max;
        return `changing max creeps for ${this.name} in ${this.operation.name} from ${oldValue} to ${max}`;
    }
    setSpawnGroup(spawnGroup) {
        this.spawnGroup = spawnGroup;
    }
    invalidateSpawnDistance() {
        if (this.memory.distanceToSpawn) {
            console.log(`SPAWN: resetting distance for ${this.name} in ${this.operation.name}`);
            this.memory.distanceToSpawn = undefined;
        }
    }
    /**
     * General purpose function for spawning creeps
     * @param roleName - Used to find creeps belonging to this role, examples: miner, energyCart
     * @param getBody - function that returns the body to be used if a new creep needs to be spawned
     * @param getMax - function that returns how many creeps are currently desired, pass 0 to halt spawning
     * @param options - Optional parameters like prespawn interval, whether to disable attack notifications, etc.
     * @returns {Agent[]}
     */
    headCount(roleName, getBody, getMax, options = {}) {
        let agentArray = [];
        if (!this.memory.hc[roleName])
            this.memory.hc[roleName] = this.findOrphans(roleName);
        let creepNames = this.memory.hc[roleName];
        let count = 0;
        for (let i = 0; i < creepNames.length; i++) {
            let creepName = creepNames[i];
            let creep = Game.creeps[creepName];
            if (creep) {
                let agent = new Agent(creep, this);
                let prepared = this.prepAgent(agent, options);
                if (prepared)
                    agentArray.push(agent);
                let ticksNeeded = 0;
                if (options.prespawn !== undefined) {
                    ticksNeeded += creep.body.length * 3;
                    ticksNeeded += options.prespawn;
                }
                if (!creep.ticksToLive || creep.ticksToLive > ticksNeeded) {
                    count++;
                }
            }
            else {
                creepNames.splice(i, 1);
                delete Memory.creeps[creepName];
                i--;
            }
        }
        let spawnGroup = this.spawnGroup;
        if (options.altSpawnGroup) {
            spawnGroup = options.altSpawnGroup;
        }
        let allowSpawn = spawnGroup.isAvailable && this.allowSpawn && (this.hasVision || options.blindSpawn);
        if (allowSpawn && count < getMax()) {
            let creepName = `${this.operation.name}_${roleName}_${Math.floor(Math.random() * 100)}`;
            let outcome = spawnGroup.spawn(getBody(), creepName, options.memory, options.reservation);
            if (_.isString(outcome)) {
                creepNames.push(creepName);
            }
        }
        return agentArray;
    }
    spawnSharedAgent(roleName, getBody) {
        let spawnMemory = this.spawnGroup.spawns[0].memory;
        if (!spawnMemory.communityRoles)
            spawnMemory.communityRoles = {};
        let employerName = this.operation.name + this.name;
        let creep;
        if (spawnMemory.communityRoles[roleName]) {
            let creepName = spawnMemory.communityRoles[roleName];
            creep = Game.creeps[creepName];
            if (creep && Game.map.getRoomLinearDistance(this.spawnGroup.room.name, creep.room.name) <= 3) {
                if (creep.memory.employer === employerName || (!creep.memory.lastTickEmployed || Game.time - creep.memory.lastTickEmployed > 1)) {
                    creep.memory.employer = employerName;
                    creep.memory.lastTickEmployed = Game.time;
                    return new Agent(creep, this);
                }
            }
            else {
                delete Memory.creeps[creepName];
                delete spawnMemory.communityRoles[roleName];
            }
        }
        if (!creep && this.spawnGroup.isAvailable) {
            let creepName = "community_" + roleName;
            while (Game.creeps[creepName]) {
                creepName = "community_" + roleName + "_" + Math.floor(Math.random() * 100);
            }
            let outcome = this.spawnGroup.spawn(getBody(), creepName, undefined, undefined);
            if (_.isString(outcome)) {
                spawnMemory.communityRoles[roleName] = outcome;
            }
            else if (Game.time % 10 !== 0 && outcome !== ERR_NOT_ENOUGH_RESOURCES) {
                console.log(`error spawning community ${roleName} in ${this.operation.name} outcome: ${outcome}`);
            }
        }
    }
    /**
     * Returns creep body array with desired number of parts in this order: WORK → CARRY → MOVE
     * @param workCount
     * @param carryCount
     * @param movecount
     * @returns {string[]}
     */
    workerBody(workCount, carryCount, movecount) {
        let body = [];
        for (let i = 0; i < workCount; i++) {
            body.push(WORK);
        }
        for (let i = 0; i < carryCount; i++) {
            body.push(CARRY);
        }
        for (let i = 0; i < movecount; i++) {
            body.push(MOVE);
        }
        return body;
    }
    configBody(config) {
        let body = [];
        for (let partType in config) {
            let amount = config[partType];
            for (let i = 0; i < amount; i++) {
                body.push(partType);
            }
        }
        return body;
    }
    /**
     * Returns creep body array with the desired ratio of parts, governed by how much spawn energy is possible
     * @param workRatio
     * @param carryRatio
     * @param moveRatio
     * @param spawnFraction - proportion of spawn energy to be used up to 50 body parts, .5 would use half, 1 would use all
     * @param limit - set a limit to the number of units (useful if you know the exact limit, like with miners)
     * @returns {string[]}
     */
    bodyRatio(workRatio, carryRatio, moveRatio, spawnFraction, limit) {
        let sum = workRatio * 100 + carryRatio * 50 + moveRatio * 50;
        let partsPerUnit = workRatio + carryRatio + moveRatio;
        if (!limit)
            limit = Math.floor(50 / partsPerUnit);
        let maxUnits = Math.min(Math.floor((this.spawnGroup.maxSpawnEnergy * spawnFraction) / sum), limit);
        return this.workerBody(workRatio * maxUnits, carryRatio * maxUnits, moveRatio * maxUnits);
    }
    /**
     * General purpose checking for creep load
     * @param creep
     * @returns {boolean}
     */
    hasLoad(creep) {
        if (creep.memory.hasLoad && _.sum(creep.carry) === 0) {
            creep.memory.hasLoad = false;
        }
        else if (!creep.memory.hasLoad && _.sum(creep.carry) === creep.carryCapacity) {
            creep.memory.hasLoad = true;
        }
        return creep.memory.hasLoad;
    }
    // deprecated
    /**
     * Used to determine cart count/size based on transport distance and the bandwidth needed
     * @param distance - distance (or average distance) from point A to point B
     * @param load - how many resource units need to be transported per tick (example: 10 for an energy source)
     * @returns {{body: string[], cartsNeeded: number}}
     */
    cacheTransportAnalysis(distance, load) {
        if (!this.memory.transportAnalysis || load !== this.memory.transportAnalysis.load
            || distance !== this.memory.transportAnalysis.distance) {
            this.memory.transportAnalysis = Mission.analyzeTransport(distance, load, this.spawnGroup.maxSpawnEnergy);
        }
        return this.memory.transportAnalysis;
    }
    // deprecated
    static analyzeTransport(distance, load, maxSpawnEnergy) {
        // cargo units are just 2 CARRY, 1 MOVE, which has a capacity of 100 and costs 150
        let maxUnitsPossible = Math.min(Math.floor(maxSpawnEnergy /
            ((BODYPART_COST[CARRY] * 2) + BODYPART_COST[MOVE])), 16);
        let bandwidthNeeded = distance * load * 2.1;
        let cargoUnitsNeeded = Math.ceil(bandwidthNeeded / (CARRY_CAPACITY * 2));
        let cartsNeeded = Math.ceil(cargoUnitsNeeded / maxUnitsPossible);
        let cargoUnitsPerCart = Math.floor(cargoUnitsNeeded / cartsNeeded);
        return {
            load: load,
            distance: distance,
            cartsNeeded: cartsNeeded,
            carryCount: cargoUnitsPerCart * 2,
            moveCount: cargoUnitsPerCart,
        };
    }
    // deprecated
    static loadFromSource(source) {
        return Math.max(source.energyCapacity, SOURCE_ENERGY_CAPACITY) / ENERGY_REGEN_TIME;
    }
    getFlagSet(identifier, max = 10) {
        let flags = [];
        for (let i = 0; i < max; i++) {
            let flag = Game.flags[this.operation.name + identifier + i];
            if (flag) {
                flags.push(flag);
            }
        }
        return flags;
    }
    flagLook(lookConstant, identifier, max = 10) {
        let objects = [];
        let flags = this.getFlagSet(identifier, max);
        for (let flag of flags) {
            if (flag.room) {
                let object = _.head(flag.pos.lookFor(lookConstant));
                if (object) {
                    objects.push(object);
                }
                else {
                    flag.remove();
                }
            }
        }
        return objects;
    }
    // deprecated, use similar function on TransportGuru
    getStorage(pos) {
        if (this.memory.tempStorageId) {
            let storage = Game.getObjectById(this.memory.tempStorageId);
            if (storage) {
                return storage;
            }
            else {
                console.log("ATTN: Clearing temporary storage id due to not finding object in", this.operation.name);
                this.memory.tempStorageId = undefined;
            }
        }
        // invalidated periodically
        if (!this.memory.nextStorageCheck || Game.time >= this.memory.nextStorageCheck) {
            let bestStorages = RoomHelper.findClosest({ pos: pos }, _.filter(Game.structures, s => s.structureType == STRUCTURE_STORAGE), { linearDistanceLimit: MAX_HARVEST_DISTANCE });
            bestStorages = _.filter(bestStorages, value => value.distance < MAX_HARVEST_PATH);
            let resultPosition;
            if (bestStorages.length > 0) {
                let result = bestStorages[0].destination;
                resultPosition = result.pos;
                this.memory.storageId = result.id;
                this.memory.nextStorageCheck = Game.time + helper.randomInterval(10000); // Around 10 hours
            }
            else {
                this.memory.nextStorageCheck = Game.time + 100; // Around 6 minutes
            }
            console.log(`MISSION: finding storage for ${this.operation.name}, result: ${resultPosition}`);
        }
        if (this.memory.storageId) {
            let storage = Game.getObjectById(this.memory.storageId);
            if (storage && storage.room.controller.level >= 4) {
                return storage;
            }
            else {
                this.memory.storageId = undefined;
                this.memory.nextStorageCheck = Game.time;
                return this.getStorage(pos);
            }
        }
    }
    findOrphans(roleName) {
        let creepNames = [];
        for (let creepName in Game.creeps) {
            if (creepName.indexOf(this.operation.name + "_" + roleName + "_") > -1) {
                creepNames.push(creepName);
            }
        }
        return creepNames;
    }
    recycleAgent(agent) {
        let spawn = this.spawnGroup.spawns[0];
        if (agent.pos.isNearTo(spawn)) {
            spawn.recycleCreep(agent.creep);
        }
        else {
            agent.travelTo(spawn);
        }
    }
    prepAgent(agent, options) {
        if (!agent.memory.prep) {
            if (options.disableNotify) {
                this.disableNotify(agent);
            }
            let boosted = agent.seekBoost(agent.memory.boosts, agent.memory.allowUnboosted);
            if (!boosted)
                return false;
            if (agent.creep.spawning)
                return false;
            if (!options.skipMoveToRoom && (agent.pos.roomName !== this.flag.pos.roomName || agent.pos.isNearExit(1))) {
                agent.avoidSK(this.flag);
                return;
            }
            agent.memory.prep = true;
        }
        return true;
    }
    findPartnerships(agents, role) {
        for (let agent of agents) {
            if (!agent.memory.partner) {
                if (!this.partnerPairing[role])
                    this.partnerPairing[role] = [];
                this.partnerPairing[role].push(agent);
                for (let otherRole in this.partnerPairing) {
                    if (role === otherRole)
                        continue;
                    let otherCreeps = this.partnerPairing[otherRole];
                    let closestCreep;
                    let smallestAgeDifference = Number.MAX_VALUE;
                    for (let otherCreep of otherCreeps) {
                        let ageDifference = Math.abs(agent.ticksToLive - otherCreep.ticksToLive);
                        if (ageDifference < smallestAgeDifference) {
                            smallestAgeDifference = ageDifference;
                            closestCreep = otherCreep;
                        }
                    }
                    if (closestCreep) {
                        closestCreep.memory.partner = agent.name;
                        agent.memory.partner = closestCreep.name;
                    }
                }
            }
        }
    }
    getPartner(agent, possibilities) {
        for (let possibility of possibilities) {
            if (possibility.name === agent.memory.partner) {
                return possibility;
            }
        }
    }
    findDistanceToSpawn(destination) {
        if (!this.memory.distanceToSpawn) {
            let roomLinearDistance = Game.map.getRoomLinearDistance(this.spawnGroup.pos.roomName, destination.roomName);
            if (roomLinearDistance <= OBSERVER_RANGE) {
                let ret = empire.traveler.findTravelPath(this.spawnGroup, { pos: destination });
                if (ret.incomplete) {
                    console.log(`SPAWN: error finding distance in ${this.operation.name} for object at ${destination}`);
                    console.log(`fallback to linearRoomDistance`);
                    this.memory.distanceToSpawn = roomLinearDistance * 50 + 25;
                }
                else {
                    this.memory.distanceToSpawn = ret.path.length;
                }
            }
            else {
                console.log(`SPAWN: likely portal travel detected in ${this.operation.name}, setting distance to 200`);
                this.memory.distanceToSpawn = 200;
            }
        }
        return this.memory.distanceToSpawn;
    }
    disableNotify(creep) {
        if (creep instanceof Agent) {
            creep = creep.creep;
        }
        if (!creep.memory.notifyDisabled) {
            creep.notifyWhenAttacked(false);
            creep.memory.notifyDisabled = true;
        }
    }
    pavePath(start, finish, rangeAllowance, ignoreLimit = false) {
        if (Game.time - this.memory.paveTick < 1000)
            return;
        if (Game.map.getRoomLinearDistance(start.pos.roomName, finish.pos.roomName) > 2) {
            console.log(`PAVER: path too long: ${start.pos.roomName} to ${finish.pos.roomName}`);
            return;
        }
        let path = this.findPavedPath(start.pos, finish.pos, rangeAllowance);
        if (!path) {
            console.log(`incomplete pavePath, please investigate (${this.operation.name}), start: ${start.pos}, finish: ${finish.pos}, mission: ${this.name}`);
            return;
        }
        let newConstructionPos = this.examinePavedPath(path);
        if (newConstructionPos && (ignoreLimit || Object.keys(Game.constructionSites).length < 60)) {
            if (!Game.cache.placedRoad) {
                Game.cache.placedRoad = true;
                console.log(`PAVER: placed road ${newConstructionPos} in ${this.operation.name}`);
                newConstructionPos.createConstructionSite(STRUCTURE_ROAD);
            }
        }
        else {
            this.memory.paveTick = Game.time;
            if (_.last(path).inRangeTo(finish.pos, rangeAllowance)) {
                return path.length;
            }
        }
    }
    // This path making will only be valid for an origin/destination with a roomdistance less than 3
    findPavedPath(start, finish, rangeAllowance) {
        const ROAD_COST = 3;
        const PLAIN_COST = 4;
        const SWAMP_COST = 5;
        const AVOID_COST = 7;
        let maxDistance = Game.map.getRoomLinearDistance(start.roomName, finish.roomName);
        let ret = PathFinder.search(start, [{ pos: finish, range: rangeAllowance }], {
            plainCost: PLAIN_COST,
            swampCost: SWAMP_COST,
            maxOps: 12000,
            roomCallback: (roomName) => {
                // disqualify rooms that involve a circuitous path
                if (Game.map.getRoomLinearDistance(start.roomName, roomName) > maxDistance) {
                    return false;
                }
                // disqualify enemy rooms
                if (Traveler.checkOccupied(roomName)) {
                    return false;
                }
                let room = Game.rooms[roomName];
                if (!room) {
                    let roomType = WorldMap.roomTypeFromName(roomName);
                    if (roomType === ROOMTYPE_ALLEY) {
                        let matrix = new PathFinder.CostMatrix();
                        return helper.blockOffExits(matrix, AVOID_COST, roomName);
                    }
                    return;
                }
                let matrix = new PathFinder.CostMatrix();
                Traveler.addStructuresToMatrix(room, matrix, ROAD_COST);
                // avoid controller
                if (room.controller) {
                    helper.blockOffPosition(matrix, room.controller, 3, AVOID_COST);
                }
                // avoid container/link adjacency
                let sources = room.find(FIND_SOURCES);
                for (let source of sources) {
                    let structure = source.findMemoStructure(STRUCTURE_CONTAINER, 1);
                    if (!structure) {
                        structure = source.findMemoStructure(STRUCTURE_LINK, 1);
                    }
                    if (structure) {
                        helper.blockOffPosition(matrix, structure, 1, AVOID_COST);
                    }
                }
                // add construction sites too
                let constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
                for (let site of constructionSites) {
                    if (site.structureType === STRUCTURE_ROAD) {
                        matrix.set(site.pos.x, site.pos.y, ROAD_COST);
                    }
                    else {
                        matrix.set(site.pos.x, site.pos.y, 0xff);
                    }
                }
                // avoid going too close to lairs
                for (let lair of room.findStructures(STRUCTURE_KEEPER_LAIR)) {
                    helper.blockOffPosition(matrix, lair, 1, AVOID_COST);
                }
                return matrix;
            },
        });
        if (!ret.incomplete) {
            return ret.path;
        }
    }
    examinePavedPath(path) {
        let repairIds = [];
        let hitsToRepair = 0;
        for (let i = 0; i < path.length; i++) {
            let position = path[i];
            if (!Game.rooms[position.roomName])
                return;
            if (position.isNearExit(0))
                continue;
            let road = position.lookForStructure(STRUCTURE_ROAD);
            if (road) {
                repairIds.push(road.id);
                hitsToRepair += road.hitsMax - road.hits;
                // TODO: calculate how much "a whole lot" should be based on paver repair rate
                const A_WHOLE_LOT = 1000000;
                if (!this.memory.roadRepairIds && (hitsToRepair > A_WHOLE_LOT || road.hits < road.hitsMax * .20)) {
                    console.log(`PAVER: I'm being summoned in ${this.operation.name}`);
                    this.memory.roadRepairIds = repairIds;
                }
                continue;
            }
            let construction = position.lookFor(LOOK_CONSTRUCTION_SITES)[0];
            if (construction)
                continue;
            return position;
        }
    }
    paverActions(paver) {
        // paver, healthyself
        if (paver.hits < paver.hitsMax) {
            if (paver.room.hostiles.length === 0 && !paver.pos.isNearExit(0)) {
                let tower = paver.pos.findClosestByRange(paver.room.findStructures(STRUCTURE_TOWER));
                if (tower) {
                    tower.heal(paver.creep);
                    return;
                }
            }
            let healersInRoom = _.filter(paver.room.find(FIND_MY_CREEPS), c => c.getActiveBodyparts(HEAL));
            if (healersInRoom.length > 0) {
                paver.idleOffRoad();
                return;
            }
            if (paver.getActiveBodyparts(WORK) === 0) {
                paver.travelTo(this.spawnGroup);
                return;
            }
        }
        let hasLoad = paver.hasLoad();
        if (!hasLoad) {
            paver.procureEnergy(this.findRoadToRepair());
            return;
        }
        let road = this.findRoadToRepair();
        if (!road) {
            console.log(`this is ${this.operation.name} paver, checking out with ${paver.ticksToLive} ticks to live`);
            delete Memory.creeps[paver.name];
            paver.idleOffRoad(this.room.controller);
            return;
        }
        let paving = false;
        if (paver.pos.inRangeTo(road, 3) && !paver.pos.isNearExit(0)) {
            paving = paver.repair(road) === OK;
            let hitsLeftToRepair = road.hitsMax - road.hits;
            if (hitsLeftToRepair > 10000) {
                paver.yieldRoad(road, true);
            }
            else if (hitsLeftToRepair > 1500) {
                paver.yieldRoad(road, false);
            }
        }
        else {
            paver.travelTo(road, { range: 0 });
        }
        if (!paving) {
            road = paver.pos.lookForStructure(STRUCTURE_ROAD);
            if (road && road.hits < road.hitsMax)
                paver.repair(road);
        }
        paver.stealNearby("creep");
    }
    findRoadToRepair() {
        if (!this.memory.roadRepairIds)
            return;
        let road = Game.getObjectById(this.memory.roadRepairIds[0]);
        if (road && road.hits < road.hitsMax) {
            return road;
        }
        else {
            this.memory.roadRepairIds.shift();
            if (this.memory.roadRepairIds.length > 0) {
                return this.findRoadToRepair();
            }
            else {
                this.memory.roadRepairIds = undefined;
            }
        }
    }
    spawnPaver() {
        if (this.room.controller && this.room.controller.level === 1)
            return;
        let paverBody = () => { return this.bodyRatio(1, 3, 2, 1, 5); };
        return this.spawnSharedAgent("paver", paverBody);
    }
    registerPrespawn(agent) {
        if (!agent.memory.registered) {
            agent.memory.registered = true;
            const SANITY_CHECK = CREEP_LIFE_TIME / 2;
            this.memory.prespawn = Math.max(CREEP_LIFE_TIME - agent.creep.ticksToLive, SANITY_CHECK);
        }
    }
    medicActions(defender) {
        let hurtCreep = this.findHurtCreep(defender);
        if (!hurtCreep) {
            defender.idleNear(this.flag, 12);
            return;
        }
        // move to creep
        let range = defender.pos.getRangeTo(hurtCreep);
        if (range > 1) {
            defender.travelTo(hurtCreep, { movingTarget: true });
        }
        else {
            defender.yieldRoad(hurtCreep, true);
        }
        if (range === 1) {
            defender.heal(hurtCreep);
        }
        else if (range <= 3) {
            defender.rangedHeal(hurtCreep);
        }
    }
    findHurtCreep(defender) {
        if (!this.room)
            return;
        if (defender.memory.healId) {
            let creep = Game.getObjectById(defender.memory.healId);
            if (creep && creep.room.name === defender.room.name && creep.hits < creep.hitsMax) {
                return creep;
            }
            else {
                defender.memory.healId = undefined;
                return this.findHurtCreep(defender);
            }
        }
        else if (!defender.memory.healCheck || Game.time - defender.memory.healCheck > 25) {
            defender.memory.healCheck = Game.time;
            let hurtCreep = _(this.room.find(FIND_MY_CREEPS))
                .filter((c) => c.hits < c.hitsMax && c.ticksToLive > 100)
                .sortBy((c) => -c.partCount(WORK))
                .head();
            if (hurtCreep) {
                defender.memory.healId = hurtCreep.id;
                return hurtCreep;
            }
        }
    }
}

class EmergencyMinerMission extends Mission {
    /**
     * Checks every 100 ticks if storage is full or a miner is present, if not spawns an emergency miner. Should come
     * first in FortOperation
     * @param operation
     */
    constructor(operation) {
        super(operation, "emergencyMiner");
    }
    initMission() {
    }
    roleCall() {
        let energyAvailable = this.spawnGroup.currentSpawnEnergy >= 1300 ||
            (this.room.storage && this.room.storage.store.energy > 1300) || this.findMinersBySources();
        if (energyAvailable) {
            this.memory.lastTick = Game.time;
        }
        let getMaxMiners = () => {
            if (!this.memory.lastTick || Game.time > this.memory.lastTick + 100) {
                if (Game.time % 10 === 0) {
                    console.log("ATTN: Backup miner being spawned in", this.operation.name);
                }
                return 2;
            }
        };
        this.emergencyMiners = this.headCount("emergencyMiner", () => this.workerBody(2, 1, 1), getMaxMiners);
    }
    missionActions() {
        for (let miner of this.emergencyMiners) {
            this.minerActions(miner);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    minerActions(miner) {
        let closest = miner.pos.findClosestByRange(FIND_SOURCES);
        if (!miner.pos.isNearTo(closest)) {
            miner.travelTo(closest);
            return;
        }
        miner.memory.donatesEnergy = true;
        miner.memory.scavanger = RESOURCE_ENERGY;
        miner.harvest(closest);
    }
    findMinersBySources() {
        for (let source of this.room.find(FIND_SOURCES)) {
            if (source.pos.findInRange(FIND_MY_CREEPS, 1, { filter: (c) => c.partCount(WORK) > 0 }).length > 0) {
                return true;
            }
        }
        return false;
    }
}

class RefillMission extends Mission {
    /**
     * General-purpose structure refilling. Can be used to refill spawning energy, towers, links, labs, etc.
     *  Will default to drawing energy from storage, and use altBattery if there is no storage with energy
     * @param operation
     */
    constructor(operation) {
        super(operation, "refill");
    }
    initMission() {
        this.emergencyMode = this.memory.cartsLastTick === 0;
    }
    roleCall() {
        let max = () => this.room.storage ? 1 : 2;
        let emergencyMax = () => this.emergencyMode ? 1 : 0;
        let emergencyBody = () => { return this.workerBody(0, 4, 2); };
        this.emergencyCarts = this.headCount("emergency_" + this.name, emergencyBody, emergencyMax);
        let cartBody = () => {
            if (this.operation.type === "flex") {
                return this.bodyRatio(0, 2, 1, 1, 16);
            }
            else {
                return this.bodyRatio(0, 2, 1, 1, 10);
            }
        };
        let memory = { scavanger: RESOURCE_ENERGY };
        this.carts = this.headCount("spawnCart", cartBody, max, { prespawn: 50, memory: memory });
        this.memory.cartsLastTick = this.carts.length;
    }
    missionActions() {
        for (let cart of this.emergencyCarts) {
            this.spawnCartActions(cart, 0);
        }
        let order = 0;
        for (let cart of this.carts) {
            this.spawnCartActions(cart, order);
            order++;
        }
    }
    spawnCartActions2(cart, order) {
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            if (order !== 0 && cart.ticksToLive < 50) {
                cart.suicide();
                return;
            }
            cart.memory.emptyId = undefined;
            cart.procureEnergy(this.findNearestEmpty(cart), true);
            return;
        }
    }
    spawnCartActions(cart, order) {
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            if (order !== 0 && cart.ticksToLive < 50) {
                cart.suicide();
                return;
            }
            cart.memory.emptyId = undefined;
            cart.procureEnergy(this.findNearestEmpty(cart), true);
            return;
        }
        let target = this.findNearestEmpty(cart);
        if (!target) {
            if (cart.carry.energy < cart.carryCapacity * .8) {
                cart.memory.hasLoad = false;
            }
            else {
                cart.idleOffRoad(cart.room.controller);
            }
            return;
        }
        // has target
        if (!cart.pos.isNearTo(target)) {
            cart.travelTo(target);
            if (this.room.storage && cart.pos.isNearTo(this.room.storage) &&
                cart.carry.energy <= cart.carryCapacity - 50) {
                cart.withdraw(this.room.storage, RESOURCE_ENERGY);
            }
            return;
        }
        // is near to target
        let outcome = cart.transfer(target, RESOURCE_ENERGY);
        if (outcome === OK) {
            if (cart.carry.energy > target.energyCapacity) {
                cart.memory.emptyId = undefined;
                target = this.findNearestEmpty(cart, target);
                if (target && !cart.pos.isNearTo(target)) {
                    cart.travelTo(target);
                }
            }
            else if (this.room.storage) {
                cart.travelTo(this.room.storage);
            }
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    findNearestEmpty(cart, pullTarget) {
        if (cart.memory.emptyId) {
            let empty = Game.getObjectById(cart.memory.emptyId);
            if (empty && empty.energy < empty.energyCapacity) {
                let rangeToEmpty = cart.pos.getRangeTo(empty);
                let closestEmpty = cart.pos.findClosestByRange(this.getEmpties());
                let rangeToClosest = cart.pos.getRangeTo(closestEmpty);
                if (rangeToEmpty > rangeToClosest) {
                    cart.memory.emptyId = closestEmpty.id;
                    return closestEmpty;
                }
                else {
                    return empty;
                }
            }
            else {
                delete cart.memory.emptyId;
                return this.findNearestEmpty(cart, pullTarget);
            }
        }
        else {
            let closestEmpty = cart.pos.findClosestByRange(this.getEmpties(pullTarget));
            if (closestEmpty) {
                cart.memory.emptyId = closestEmpty.id;
                return closestEmpty;
            }
        }
    }
    getEmpties(pullTarget) {
        if (!this.empties) {
            this.empties = _.filter(this.room.findStructures(STRUCTURE_SPAWN)
                .concat(this.room.findStructures(STRUCTURE_EXTENSION)), (s) => {
                return s.energy < s.energyCapacity;
            });
            this.empties = this.empties.concat(_.filter(this.room.findStructures(STRUCTURE_TOWER), (s) => { return s.energy < s.energyCapacity * .5; }));
        }
        if (pullTarget) {
            _.pull(this.empties, pullTarget);
        }
        return this.empties;
    }
}

class LinkMiningMission extends Mission {
    /**
     * Sends a miner to a source with a link, energy transfer is managed by LinkNetworkMission
     * @param operation
     * @param name
     * @param source
     * @param link
     */
    constructor(operation, name, source, link) {
        super(operation, name);
        this.source = source;
        this.link = link;
    }
    initMission() {
    }
    roleCall() {
        this.linkMiners = this.headCount(this.name, () => this.workerBody(5, 4, 5), () => 1);
    }
    missionActions() {
        for (let miner of this.linkMiners) {
            this.minerActions(miner);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    minerActions(miner) {
        if (!miner.memory.inPosition) {
            this.moveToPosition(miner);
            return; // early
        }
        miner.memory.donatesEnergy = true;
        miner.memory.scavanger = RESOURCE_ENERGY;
        miner.harvest(this.source);
        if (miner.carry.energy === miner.carryCapacity) {
            miner.transfer(this.link, RESOURCE_ENERGY);
        }
    }
    /**
     * Picks a position between the source and the link and moves there, robbing and killing any miner at that position
     * @param miner
     */
    moveToPosition(miner) {
        let roadPos;
        for (let i = 1; i <= 8; i++) {
            let position = this.source.pos.getPositionAtDirection(i);
            if (!position.isPassible(true))
                continue;
            if (!position.isNearTo(this.link))
                continue;
            if (position.lookForStructure(STRUCTURE_ROAD)) {
                roadPos = position;
            }
            if (miner.pos.inRangeTo(position, 0)) {
                miner.memory.inPosition = true;
            }
            else {
                miner.moveItOrLoseIt(position, "miner");
            }
            return; // early
        }
        if (!miner.memory.posNotify) {
            miner.memory.posNotify = true;
            console.log("couldn't find valid position for", miner.name, "in ", miner.room.name);
        }
        if (miner.pos.inRangeTo(roadPos, 0)) {
            miner.memory.inPosition = true;
        }
        else {
            miner.moveItOrLoseIt(roadPos, "miner");
        }
    }
}

class MiningMission extends Mission {
    /**
     * General-purpose energy mining, uses a nested TransportMission to transfer energy
     * @param operation
     * @param name
     * @param source
     * @param remoteSpawning
     */
    constructor(operation, name, source, remoteSpawning = false) {
        super(operation, name);
        this.getMaxMiners = () => this.minersNeeded;
        this.getMinerBody = () => {
            if (this.remoteSpawning) {
                return this.workerBody(6, 1, 6);
            }
            let minersSupported = this.minersSupported();
            if (minersSupported === 1) {
                let work = Math.ceil((Math.max(this.source.energyCapacity, SOURCE_ENERGY_CAPACITY) / ENERGY_REGEN_TIME) / HARVEST_POWER) + 1;
                return this.workerBody(work, 1, Math.ceil(work / 2));
            }
            else if (minersSupported === 2) {
                return this.workerBody(3, 1, 2);
            }
            else {
                return this.workerBody(2, 1, 1);
            }
        };
        this.getMaxCarts = () => {
            if (!this.storage || this.storage.room.controller.level < 4) {
                return 0;
            }
            const FULL_STORAGE_THRESHOLD = STORAGE_CAPACITY - 50000;
            if (_.sum(this.storage.store) > FULL_STORAGE_THRESHOLD) {
                return 0;
            }
            if (!this.container) {
                return 0;
            }
            return this.analysis.cartsNeeded;
        };
        this.getCartBody = () => {
            return this.workerBody(0, this.analysis.carryCount, this.analysis.moveCount);
        };
        this.source = source;
        this.remoteSpawning = remoteSpawning;
    }
    // return-early
    initMission() {
        if (!this.hasVision) {
            return;
        }
        this.container = this.findContainer();
        this.storage = this.findMinerStorage();
    }
    roleCall() {
        let prespawn = 0;
        if (this.storage) {
            prespawn = Game.map.getRoomLinearDistance(this.source.pos.roomName, this.storage.pos.roomName) * 50 + 50;
        }
        this.miners = this.headCount(this.name, this.getMinerBody, this.getMaxMiners, { prespawn: prespawn });
        if (this.memory.roadRepairIds) {
            this.paver = this.spawnPaver();
        }
        let memory = { scavanger: RESOURCE_ENERGY };
        this.minerCarts = this.headCount(this.name + "cart", this.getCartBody, this.getMaxCarts, { prespawn: this.analysis.distance, memory: memory });
    }
    missionActions() {
        let order = 0;
        for (let miner of this.miners) {
            this.minerActions(miner, order);
            order++;
        }
        for (let cart of this.minerCarts) {
            this.cartActions(cart);
        }
        if (this.paver) {
            this.paverActions(this.paver);
        }
        if (this.container) {
            let startingPosition = this.storage;
            if (!startingPosition) {
                startingPosition = this.room.find(FIND_MY_SPAWNS)[0];
            }
            if (!startingPosition) {
                startingPosition = this.room.find(FIND_CONSTRUCTION_SITES, { filter: ((s) => s.structureType === STRUCTURE_SPAWN) })[0];
            }
            if (startingPosition) {
                if (Game.map.getRoomLinearDistance(startingPosition.pos.roomName, this.container.pos.roomName) > 2) {
                    console.log(`path too long for miner in ${this.operation.name}`);
                    return;
                }
                let distance = this.pavePath(startingPosition, this.container, 2);
                if (distance) {
                    this.memory.distanceToStorage = distance;
                }
            }
        }
    }
    finalizeMission() { }
    invalidateMissionCache() {
        this.memory.transportAnalysis = undefined;
    }
    minerActions(miner, order) {
        let fleeing = miner.fleeHostiles();
        if (fleeing) {
            this.dropEnergy(miner);
            return;
        }
        if (!this.hasVision) {
            miner.travelTo(this.flag);
            return; // early
        }
        if (!this.container) {
            let reserveEnergy = order === 0 && this.minersNeeded > 1;
            this.buildContainer(miner, this.source, reserveEnergy);
            return;
        }
        if (order === 0) {
            this.leadMinerActions(miner, this.source, this.container);
            if (!miner.memory.registered && miner.pos.isNearTo(this.source)) {
                this.registerPrespawn(miner);
            }
        }
        else {
            if (this.minersNeeded === 1) {
                this.replaceCurrentMiner(miner, this.container);
            }
            else {
                this.backupMinerActions(miner, this.source, this.container);
            }
        }
    }
    cartActions(cart) {
        let fleeing = cart.fleeHostiles();
        if (fleeing) {
            return;
        } // early
        // emergency cpu savings
        if (Game.cpu.bucket < 1000) {
            return;
        }
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            // heal chipped carts
            if (cart.hits < cart.hitsMax) {
                let healersInRoom = _.filter(cart.room.find(FIND_MY_CREEPS), c => c.getActiveBodyparts(HEAL));
                if (healersInRoom.length > 0) {
                    cart.idleOffRoad();
                    return;
                }
                if (cart.room.hostiles.length === 0 && !cart.pos.isNearExit(0)) {
                    let tower = cart.pos.findClosestByRange(cart.room.findStructures(STRUCTURE_TOWER));
                    if (tower) {
                        tower.heal(cart.creep);
                        return;
                    }
                }
                if (cart.carryCapacity === 0) {
                    cart.travelTo(this.storage);
                    return;
                }
            }
            if (!this.container) {
                cart.idleOffRoad();
                return;
            }
            let range = cart.pos.getRangeTo(this.container);
            if (range > 3) {
                cart.travelTo(this.container, { offRoad: true });
                return;
            }
            if (this.container.store.energy < cart.creep.carryCapacity) {
                cart.idleNear(this.container, 3);
                return;
            }
            let outcome = cart.retrieve(this.container, RESOURCE_ENERGY);
            if (outcome === OK && cart.carryCapacity > 0) {
                cart.travelTo(this.storage);
            }
            return;
        }
        let outcome = cart.deliver(this.storage, RESOURCE_ENERGY);
        if (outcome === OK) {
            if (cart.creep.ticksToLive < this.analysis.distance * 2) {
                cart.creep.suicide();
            }
            else if (cart.capacityAvailable(this.container)) {
                cart.travelTo(this.container, { offRoad: true });
            }
        }
    }
    dropEnergy(agent) {
        if (agent.creep.carry.energy > 0) {
            agent.drop(RESOURCE_ENERGY);
        }
    }
    buildContainer(miner, source, reserveEnergy) {
        if (miner.pos.isNearTo(source)) {
            if (miner.carry.energy < miner.carryCapacity || reserveEnergy) {
                miner.harvest(source);
            }
            else {
                let construction = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1)[0];
                if (construction) {
                    miner.build(construction);
                }
            }
        }
        else {
            miner.travelTo(source);
        }
    }
    leadMinerActions(miner, source, container) {
        if (miner.pos.inRangeTo(container, 0)) {
            if (container.hits < container.hitsMax * .90 && miner.carry.energy >= 20) {
                miner.repair(container);
            }
            else if (container.store.energy < container.storeCapacity) {
                miner.harvest(source);
            }
        }
        else {
            miner.travelTo(container, { range: 0 });
        }
    }
    replaceCurrentMiner(miner, container) {
        if (miner.pos.isNearTo(container)) {
            miner.moveItOrLoseIt(container.pos, "miner");
        }
        else {
            miner.travelTo(container);
        }
    }
    backupMinerActions(miner, source, container) {
        if (!miner.pos.isNearTo(source) || !miner.pos.isNearTo(container)) {
            let position = _.filter(container.pos.openAdjacentSpots(), (p) => p.isNearTo(source))[0];
            if (position) {
                miner.travelTo(position);
            }
            else {
                miner.idleNear(container, 3);
            }
            return;
        }
        if (container.hits < container.hitsMax * .90 && miner.carry.energy >= 20) {
            miner.repair(container);
        }
        else {
            miner.harvest(source);
        }
        if (miner.carry.energy >= 40) {
            miner.transfer(container, RESOURCE_ENERGY);
        }
    }
    findMinerStorage() {
        let destination = Game.flags[this.operation.name + "_sourceDestination"];
        if (destination) {
            let structure = destination.pos.lookFor(LOOK_STRUCTURES)[0];
            if (structure) {
                return structure;
            }
        }
        if (this.operation.type === "mining" || this.operation.type === "keeper") {
            return this.getStorage(this.source.pos);
        }
        else {
            if (this.room.storage && this.room.storage.my) {
                return this.flag.room.storage;
            }
        }
    }
    findContainer() {
        let container = this.source.findMemoStructure(STRUCTURE_CONTAINER, 1);
        if (!container) {
            this.placeContainer();
        }
        return container;
    }
    placeContainer() {
        if (this.room.controller.reservation &&
            /* reserved and not mine */
            this.room.controller.reservation.username != Game.structures[_.first(Object.keys(Game.structures))].owner.username) {
            // console.log(`MINER: Unable to place container in ${this.operation.name}, hostile reserved room`);
            return;
        }
        let startingPosition = this.findMinerStorage();
        if (!startingPosition) {
            startingPosition = this.room.find(FIND_MY_SPAWNS)[0];
        }
        if (!startingPosition) {
            startingPosition = this.room.find(FIND_CONSTRUCTION_SITES, { filter: ((s) => s.structureType === STRUCTURE_SPAWN) })[0];
        }
        if (!startingPosition)
            return;
        if (this.source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1).length > 0)
            return;
        let ret = PathFinder.search(this.source.pos, [{ pos: startingPosition.pos, range: 1 }], {
            maxOps: 4000,
            swampCost: 2,
            plainCost: 2,
            roomCallback: (roomName) => {
                let room = Game.rooms[roomName];
                if (!room)
                    return;
                let matrix = empire.traveler.getStructureMatrix(room);
                return matrix;
            }
        });
        if (ret.incomplete || ret.path.length === 0) {
            notifier.log(`path used for container placement in ${this.operation.name} incomplete, please investigate`);
        }
        let position = ret.path[0];
        let testPositions = _.sortBy(this.source.pos.openAdjacentSpots(true), (p) => p.getRangeTo(position));
        for (let testPosition of testPositions) {
            let sourcesInRange = testPosition.findInRange(FIND_SOURCES, 1);
            if (sourcesInRange.length > 1) {
                continue;
            }
            console.log(`MINER: placed container in ${this.operation.name}`);
            testPosition.createConstructionSite(STRUCTURE_CONTAINER);
            return;
        }
        console.log(`MINER: Unable to place container in ${this.operation.name}`);
    }
    findDistanceToStorage() {
        if (!this.memory.distanceToStorage) {
            let storage = this.findMinerStorage();
            if (!storage)
                return;
            let path = PathFinder.search(storage.pos, { pos: this.source.pos, range: 1 }).path;
            this.memory.distanceToStorage = path.length;
        }
        return this.memory.distanceToStorage;
    }
    get minersNeeded() {
        if (!this._minersNeeded) {
            if (!this.memory.positionCount) {
                this.memory.positionCount = this.source.pos.openAdjacentSpots(true).length;
            }
            this._minersNeeded = Math.min(this.minersSupported(), this.memory.positionCount);
        }
        return this._minersNeeded;
    }
    get analysis() {
        if (!this._analysis) {
            this._analysis = this.cacheTransportAnalysis(this.findDistanceToStorage(), Mission.loadFromSource(this.source));
        }
        return this._analysis;
    }
    minersSupported() {
        if (this.spawnGroup.maxSpawnEnergy >= 1050 || this.remoteSpawning) {
            return 1;
        }
        else if (this.spawnGroup.maxSpawnEnergy >= 450) {
            return 2;
        }
        else {
            return 3;
        }
    }
}

class BuilderMission extends Mission {
    /**
     * Spawns a creep to build construction and repair walls. Construction will take priority over walls
     * @param operation
     * @param defenseGuru
     * @param activateBoost
     */
    constructor(operation, defenseGuru, activateBoost = false) {
        super(operation, "builder");
        this.maxBuilders = () => {
            if (this.sites.length === 0 || this.defenseGuru.hostiles.length > 0) {
                return 0;
            }
            let potency = this.findBuilderPotency();
            let builderCost = potency * 100 + Math.ceil(potency / 2) * 50 + 150 * potency;
            return Math.min(Math.ceil(builderCost / this.spawnGroup.maxSpawnEnergy), 3);
        };
        this.maxCarts = () => {
            if (this.sites.length === 0 || this.defenseGuru.hostiles.length > 0) {
                return 0;
            }
            return this.analysis.cartsNeeded;
        };
        this.builderBody = () => {
            let potency = this.findBuilderPotency();
            if (this.spawnGroup.maxSpawnEnergy < 550) {
                return this.bodyRatio(1, 3, .5, 1, potency);
            }
            let potencyCost = potency * 100 + Math.ceil(potency / 2) * 50;
            let energyForCarry = this.spawnGroup.maxSpawnEnergy - potencyCost;
            let cartCarryCount = this.analysis.carryCount;
            let carryCount = Math.min(Math.floor(energyForCarry / 50), cartCarryCount);
            if (this.spawnGroup.room === this.room) {
                return this.workerBody(potency, carryCount, Math.ceil(potency / 2));
            }
            else {
                return this.workerBody(potency, carryCount, potency);
            }
        };
        this.defenseGuru = defenseGuru;
        this.activateBoost = activateBoost;
    }
    initMission() {
        if (this.room !== this.spawnGroup.room) {
            this.remoteSpawn = true;
        }
        this.sites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
        this.prioritySites = _.filter(this.sites, s => PRIORITY_BUILD.indexOf(s.structureType) > -1);
        if (Game.time % 10 === 5) {
            // this should be a little more cpu-friendly since it basically will only run in missionRoom that has construction
            for (let site of this.sites) {
                if (site.structureType === STRUCTURE_RAMPART || site.structureType === STRUCTURE_WALL) {
                    this.memory.maxHitsToBuild = 2000;
                    break;
                }
            }
        }
        if (!this.memory.maxHitsToBuild)
            this.memory.maxHitsToBuild = 2000;
    }
    roleCall() {
        let builderMemory;
        if (this.activateBoost) {
            builderMemory = {
                scavanger: RESOURCE_ENERGY,
                boosts: [RESOURCE_CATALYZED_LEMERGIUM_ACID],
                allowUnboosted: true
            };
        }
        else {
            builderMemory = { scavanger: RESOURCE_ENERGY };
        }
        this.builders = this.headCount(this.name, this.builderBody, this.maxBuilders, { prespawn: this.memory.prespawn, memory: builderMemory });
        this.builders = _.sortBy(this.builders, (c) => c.carry.energy);
        let cartMemory = {
            scavanger: RESOURCE_ENERGY
        };
        this.supplyCarts = this.headCount(this.name + "Cart", () => this.workerBody(0, this.analysis.carryCount, this.analysis.moveCount), this.maxCarts, { prespawn: this.memory.prespawn, memory: cartMemory });
    }
    missionActions() {
        for (let builder of this.builders) {
            this.builderActions(builder);
        }
        for (let cart of this.supplyCarts) {
            this.builderCartActions(cart);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
        this.memory.transportAnalysis = undefined;
        if (Math.random() < 0.01)
            this.memory.maxHitsToBuild = undefined;
    }
    builderActions(builder) {
        this.registerPrespawn(builder);
        let hasLoad = builder.hasLoad() || this.supplyCarts.length > 0;
        if (!hasLoad) {
            builder.procureEnergy();
            return;
        }
        // repair the rampart you just built
        if (this.memory.rampartPos) {
            let rampart = helper.deserializeRoomPosition(this.memory.rampartPos).lookForStructure(STRUCTURE_RAMPART);
            if (rampart && rampart.hits < 10000) {
                if (rampart.pos.inRangeTo(builder, 3)) {
                    builder.repair(rampart);
                }
                else {
                    builder.travelTo(rampart);
                }
                return;
            }
            else {
                this.memory.rampartPos = undefined;
            }
        }
        // has energy
        let closest;
        if (this.prioritySites.length > 0) {
            closest = builder.pos.findClosestByRange(this.prioritySites);
        }
        else {
            closest = builder.pos.findClosestByRange(this.sites);
        }
        if (!closest) {
            this.buildWalls(builder);
            return;
        }
        // has target
        let range = builder.pos.getRangeTo(closest);
        if (range <= 3) {
            let outcome = builder.build(closest);
            if (outcome === OK) {
                builder.yieldRoad(closest);
            }
            if (outcome === OK && closest.structureType === STRUCTURE_RAMPART) {
                this.memory.rampartPos = closest.pos;
            }
            // standing on top of target
            if (range === 0) {
                builder.travelTo(this.flag);
            }
        }
        else {
            builder.travelTo(closest);
        }
    }
    buildWalls(builder) {
        let target = this.findMasonTarget(builder);
        if (!target) {
            if (builder.room.controller && builder.room.controller.level < 8) {
                this.upgradeController(builder);
            }
            else {
                builder.idleOffRoad(this.flag);
            }
            return;
        }
        if (builder.pos.inRangeTo(target, 3)) {
            let outcome = builder.repair(target);
            if (outcome === OK) {
                builder.yieldRoad(target);
            }
        }
        else {
            builder.travelTo(target);
        }
    }
    findMasonTarget(builder) {
        let manualTarget = this.findManualTarget();
        if (manualTarget)
            return manualTarget;
        if (this.room.hostiles.length > 0 && this.room.hostiles[0].owner.username !== "Invader") {
            if (!this.walls) {
                this.walls = _(this.room.findStructures(STRUCTURE_RAMPART).concat(this.room.findStructures(STRUCTURE_WALL)))
                    .filter((s) => s.hits)
                    .sortBy("hits")
                    .value();
            }
            let lowest = this.walls[0];
            _.pull(this.walls, lowest);
            if (builder.memory.emergencyRepairId) {
                let structure = Game.getObjectById(builder.memory.emergencyRepairId);
                if (structure && !builder.pos.inRangeTo(lowest, 3)) {
                    return structure;
                }
                else {
                    builder.memory.emergencyRepairId = undefined;
                }
            }
            return lowest;
        }
        if (builder.memory.wallId) {
            let wall = Game.getObjectById(builder.memory.wallId);
            if (wall && wall.hits < this.memory.maxHitsToBuild) {
                return wall;
            }
            else {
                builder.memory.wallId = undefined;
                return this.findMasonTarget(builder);
            }
        }
        else {
            // look for ramparts under maxHitsToBuild
            let structures = _.filter(this.room.findStructures(STRUCTURE_RAMPART), (s) => s.hits < this.memory.maxHitsToBuild * .9);
            // look for walls under maxHitsToBuild
            if (structures.length === 0) {
                structures = _.filter(this.room.findStructures(STRUCTURE_WALL), (s) => s.hits < this.memory.maxHitsToBuild * .9);
            }
            if (structures.length === 0) {
                // increase maxHitsToBuild if there are walls/ramparts in missionRoom and re-call function
                if (this.room.findStructures(STRUCTURE_RAMPART).concat(this.room.findStructures(STRUCTURE_WALL).filter((s) => s.hits)).length > 0) {
                    // TODO: seems to produce some pretty uneven walls, find out why
                    this.memory.maxHitsToBuild += Math.pow(10, Math.floor(Math.log(this.memory.maxHitsToBuild) / Math.log(10)));
                    return this.findMasonTarget(builder);
                }
                // do nothing if there are no walls/ramparts in missionRoom
            }
            let closest = builder.pos.findClosestByRange(structures);
            if (closest) {
                builder.memory.wallId = closest.id;
                return closest;
            }
        }
    }
    findManualTarget() {
        if (this.memory.manualTargetId) {
            let target = Game.getObjectById(this.memory.manualTargetId);
            if (target && target.hits < this.memory.manualTargetHits) {
                return target;
            }
            else {
                this.memory.manualTargetId = undefined;
                this.memory.manualTargetHits = undefined;
            }
        }
    }
    upgradeController(builder) {
        if (builder.pos.inRangeTo(builder.room.controller, 3)) {
            builder.upgradeController(builder.room.controller);
            builder.yieldRoad(builder.room.controller);
        }
        else {
            builder.travelTo(builder.room.controller);
        }
    }
    findBuilderPotency() {
        if (this.room.storage) {
            if (this.room.storage.store.energy < 50000) {
                return 1;
            }
            else {
                return Math.min(Math.floor(this.room.storage.store.energy / 7500), 10);
            }
        }
        else {
            return this.room.find(FIND_SOURCES).length * 2;
        }
    }
    builderCartActions(cart) {
        let suppliedAgent = _.head(this.builders);
        if (!suppliedAgent) {
            cart.idleOffRoad(this.flag);
            return;
        }
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            cart.procureEnergy(suppliedAgent);
            return;
        }
        let rangeToBuilder = cart.pos.getRangeTo(suppliedAgent);
        if (rangeToBuilder > 3) {
            cart.travelTo(suppliedAgent);
            return;
        }
        let overCapacity = cart.carry.energy > suppliedAgent.carryCapacity - suppliedAgent.carry.energy;
        if (suppliedAgent.carry.energy > suppliedAgent.carryCapacity * .5 && overCapacity) {
            cart.yieldRoad(suppliedAgent);
            return;
        }
        if (rangeToBuilder > 1) {
            cart.travelTo(suppliedAgent);
            return;
        }
        cart.transfer(suppliedAgent.creep, RESOURCE_ENERGY);
        if (!overCapacity && this.room.storage) {
            cart.travelTo(this.room.storage);
        }
    }
    get analysis() {
        if (!this._analysis) {
            let potency = this.findBuilderPotency();
            let distance = 20;
            if (this.room.storage) {
                distance = 10;
            }
            this._analysis = this.cacheTransportAnalysis(distance, potency * 5);
        }
        return this._analysis;
    }
}

class GeologyMission extends Mission {
    constructor(operation, storeStructure) {
        super(operation, "geology");
        this.geoBody = () => {
            if (this.room.controller && this.room.controller.my) {
                return this.memory.bestBody;
            }
            else {
                return this.workerBody(33, 0, 17);
            }
        };
        this.getMaxGeo = () => {
            if (this.hasVision && this.container && this.mineral.mineralAmount > 0 && this.memory.builtExtractor) {
                return 1;
            }
            else {
                return 0;
            }
        };
        this.getMaxCarts = () => this.getMaxGeo() > 0 && this.analysis.cartsNeeded ? 1 : 0;
        this.getMaxRepairers = () => {
            if (this.mineral.mineralAmount > 5000 && this.container && this.container.hits < 50000) {
                return 1;
            }
            else {
                return 0;
            }
        };
        this.store = storeStructure;
    }
    initMission() {
        if (!this.hasVision)
            return;
        this.mineral = this.room.find(FIND_MINERALS)[0];
        if (!this.store)
            this.store = this.getStorage(this.mineral.pos);
        if (!this.store)
            return;
        this.mineralStats();
        if ((!this.room.controller || this.room.controller.level >= 7) && !this.memory.builtExtractor) {
            let extractor = this.mineral.pos.lookForStructure(STRUCTURE_EXTRACTOR);
            if (!extractor) {
                this.mineral.pos.createConstructionSite(STRUCTURE_EXTRACTOR);
            }
            this.memory.builtExtractor = true;
        }
        this.distanceToSpawn = this.findDistanceToSpawn(this.mineral.pos);
        if (!this.memory.bestBody) {
            this.memory.bestBody = this.calculateBestBody();
        }
        if (this.mineral.mineralAmount === 0 && this.mineral.ticksToRegeneration > 1000 &&
            this.mineral.ticksToRegeneration < MINERAL_REGEN_TIME - 1000) {
            return; // early
        }
        this.container = this.mineral.findMemoStructure(STRUCTURE_CONTAINER, 1);
        if (!this.container && this.memory.builtExtractor &&
            (this.mineral.ticksToRegeneration < 1000 || this.mineral.mineralAmount > 0)) {
            this.buildContainer();
        }
        this.analysis = this.cacheTransportAnalysis(this.memory.distanceToStorage, LOADAMOUNT_MINERAL);
    }
    roleCall() {
        this.geologists = this.headCount("geologist", this.geoBody, this.getMaxGeo, { prespawn: this.distanceToSpawn });
        this.carts = this.headCount("geologyCart", () => this.workerBody(0, this.analysis.carryCount, this.analysis.moveCount), this.getMaxCarts, { prespawn: this.distanceToSpawn });
        let maxRepairers = this.repairers = this.headCount("repairer", () => this.workerBody(5, 15, 10), this.getMaxRepairers);
        if (this.memory.roadRepairIds) {
            this.paver = this.spawnPaver();
        }
    }
    missionActions() {
        for (let geologist of this.geologists) {
            this.geologistActions(geologist);
        }
        for (let cart of this.carts) {
            if (this.mineral.mineralAmount > 0) {
                this.cartActions(cart);
            }
            else {
                this.cleanupCartActions(cart);
            }
        }
        for (let repairer of this.repairers) {
            this.repairActions(repairer);
        }
        if (this.paver) {
            this.paverActions(this.paver);
        }
        if (this.memory.builtExtractor) {
            let distance = this.pavePath(this.store, this.mineral, 2);
            if (distance) {
                this.memory.distanceToStorage = distance;
            }
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
        if (Math.random() < .01) {
            this.memory.storageId = undefined;
            this.memory.transportAnalysis = undefined;
            this.memory.distanceToStorage = undefined;
            this.memory.builtExtractor = undefined;
            this.memory.distanceToSpawn = undefined;
        }
    }
    calculateBestBody() {
        let bestMineAmount = 0;
        let bestMovePartsCount = 0;
        let bestWorkPartsCount = 0;
        for (let i = 1; i < 50; i++) {
            let movePartsCount = i;
            let workPartsCount = MAX_CREEP_SIZE - movePartsCount;
            let ticksPerMove = Math.ceil(1 / (movePartsCount * 2 / workPartsCount));
            let minePerTick = workPartsCount;
            let travelTime = ticksPerMove * this.distanceToSpawn;
            let mineTime = CREEP_LIFE_TIME - travelTime;
            let mineAmount = minePerTick * mineTime;
            if (mineAmount > bestMineAmount) {
                bestMineAmount = mineAmount;
                bestMovePartsCount = movePartsCount;
                bestWorkPartsCount = workPartsCount;
            }
        }
        return this.workerBody(bestWorkPartsCount, 0, bestMovePartsCount);
    }
    geologistActions(geologist) {
        let fleeing = geologist.fleeHostiles();
        if (fleeing)
            return; // early
        if (!this.container) {
            if (!geologist.pos.isNearTo(this.flag)) {
                geologist.travelTo(this.flag);
            }
            return; // early
        }
        if (!geologist.pos.inRangeTo(this.container, 0)) {
            geologist.moveItOrLoseIt(this.container.pos, "geologist");
            return; // early
        }
        if (this.mineral.mineralAmount === 0) {
            if (this.container.store[this.mineral.mineralType] === 0) {
                // break down container
                geologist.dismantle(this.container);
            }
            return; // early
        }
        if (!this.container.store[this.mineral.mineralType] ||
            this.container.store[this.mineral.mineralType] < this.container.storeCapacity - 33) {
            if (Game.time % 6 === 0)
                geologist.harvest(this.mineral);
        }
    }
    cleanupCartActions(cart) {
        let fleeing = cart.fleeHostiles();
        if (fleeing)
            return; // early
        if (_.sum(cart.carry) === cart.carryCapacity) {
            if (cart.pos.isNearTo(this.store)) {
                cart.transferEverything(this.store);
            }
            else {
                cart.travelTo(this.store);
            }
            return; // early;
        }
        if (this.container && _.sum(this.container.store) > 0) {
            if (cart.pos.isNearTo(this.container)) {
                if (this.container.store.energy > 0) {
                    cart.withdraw(this.container, RESOURCE_ENERGY);
                }
                else if (this.container.store[this.mineral.mineralType] > 0) {
                    cart.withdraw(this.container, this.mineral.mineralType);
                }
            }
            else {
                cart.travelTo(this.container);
            }
        }
        else {
            if (_.sum(cart.carry) > 0) {
                if (cart.pos.isNearTo(this.store)) {
                    cart.transferEverything(this.store);
                }
                else {
                    cart.travelTo(this.store);
                }
                return; // early;
            }
            let spawn = this.spawnGroup.spawns[0];
            if (cart.pos.isNearTo(spawn)) {
                spawn.recycleCreep(cart.creep);
                let witness = this.room.find(FIND_MY_CREEPS)[0];
                if (witness) {
                    witness.say("valhalla!");
                }
            }
            else {
                cart.travelTo(spawn);
            }
            return; // early
        }
    }
    buildContainer() {
        if (this.mineral.pos.findInRange(FIND_CONSTRUCTION_SITES, 1).length === 0) {
            let ret = empire.traveler.findTravelPath(this.mineral, this.store);
            if (ret.incomplete) {
                console.log(`MINER: bad path for finding container position ${this.flag.pos.roomName}`);
                return;
            }
            console.log("GEO: building container in", this.operation.name);
            ret.path[0].createConstructionSite(STRUCTURE_CONTAINER);
        }
    }
    cartActions(cart) {
        let fleeing = cart.fleeHostiles();
        if (fleeing)
            return; // early
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            if (!this.container) {
                if (!cart.pos.isNearTo(this.flag)) {
                    cart.travelTo(this.flag);
                }
                return;
            }
            if (_.sum(this.container.store) < cart.carryCapacity &&
                this.container.pos.lookFor(LOOK_CREEPS).length === 0) {
                cart.idleNear(this.container, 3);
                return;
            }
            if (cart.pos.isNearTo(this.container)) {
                if (this.container.store.energy > 0) {
                    cart.withdraw(this.container, RESOURCE_ENERGY);
                }
                else {
                    let outcome = cart.withdrawIfFull(this.container, this.mineral.mineralType);
                    if (outcome === OK && this.container.store[this.mineral.mineralType] >= cart.carryCapacity) {
                        cart.travelTo(this.store);
                    }
                }
            }
            else {
                cart.travelTo(this.container);
            }
            return; // early
        }
        if (cart.pos.isNearTo(this.store)) {
            let outcome = cart.transferEverything(this.store);
            if (outcome === OK && cart.ticksToLive < this.analysis.distance) {
                cart.suicide();
            }
            else if (outcome === OK) {
                cart.travelTo(this.container);
            }
        }
        else {
            cart.travelTo(this.store);
        }
    }
    repairActions(repairer) {
        let fleeing = repairer.fleeHostiles();
        if (fleeing)
            return;
        if (repairer.room.name !== this.flag.pos.roomName || repairer.pos.isNearExit(0)) {
            repairer.travelTo(this.flag);
            return;
        }
        let hasLoad = repairer.hasLoad();
        if (!hasLoad) {
            repairer.procureEnergy(this.container);
            return;
        }
        if (!this.container || this.container.hits === this.container.hitsMax) {
            repairer.idleOffRoad(this.flag);
            return;
        }
        if (repairer.pos.inRangeTo(this.container, 3)) {
            repairer.repair(this.container);
            repairer.yieldRoad(this.container);
        }
        else {
            repairer.travelTo(this.container);
        }
    }
    mineralStats() {
        if (!Game.cache[this.mineral.mineralType])
            Game.cache[this.mineral.mineralType] = 0;
        Game.cache[this.mineral.mineralType]++;
    }
}

class UpgradeMission extends Mission {
    /**
     * Controller upgrading. Will look for a suitable controller battery (StructureContainer, StructureStorage,
     * StructureLink) and if one isn't found it will spawn SupplyMission to bring energy to upgraders
     * @param operation
     * @param boost
     * @param allowSpawn
     * @param allowUnboosted
     */
    constructor(operation, boost, allowSpawn = true, allowUnboosted = true) {
        super(operation, "upgrade", allowSpawn);
        this.linkUpgraderBody = () => {
            if (this.memory.max !== undefined) {
                return this.workerBody(30, 4, 15);
            }
            if (this.remoteSpawning) {
                return this.workerBody(this.potencyPerCreep, 4, this.potencyPerCreep);
            }
            if (this.spawnGroup.maxSpawnEnergy < 800) {
                return this.bodyRatio(2, 1, 1, 1);
            }
            else {
                return this.workerBody(this.potencyPerCreep, 4, Math.ceil(this.potencyPerCreep / 2));
            }
        };
        this.getMax = () => this.findMaxUpgraders(this.totalPotency, this.potencyPerCreep);
        this.boost = boost;
        this.allowUnboosted = allowUnboosted;
    }
    initMission() {
        if (!this.memory.cartCount) {
            this.memory.cartCount = 0;
        }
        if (this.spawnGroup.room !== this.room) {
            this.remoteSpawning = true;
            this.distanceToSpawn = Game.map.getRoomLinearDistance(this.spawnGroup.room.name, this.room.name);
        }
        else {
            this.distanceToSpawn = this.findDistanceToSpawn(this.room.controller.pos);
        }
        this.battery = this.findControllerBattery();
    }
    roleCall() {
        // memory
        let memory;
        if (this.boost) { //|| empire.network.hasAbundance(RESOURCE_CATALYZED_GHODIUM_ACID)) {
            memory = { boosts: [RESOURCE_CATALYZED_GHODIUM_ACID], allowUnboosted: this.allowUnboosted };
        }
        if (this.battery instanceof StructureContainer) {
            let analysis = this.cacheTransportAnalysis(25, this.totalPotency);
            this.batterySupplyCarts = this.headCount("upgraderCart", () => this.workerBody(0, analysis.carryCount, analysis.moveCount), () => Math.min(analysis.cartsNeeded, 3), { prespawn: this.distanceToSpawn, });
        }
        this.linkUpgraders = this.headCount("upgrader", this.linkUpgraderBody, this.getMax, {
            prespawn: this.distanceToSpawn,
            memory: memory
        });
        if (this.memory.roadRepairIds && !this.remoteSpawning) {
            this.paver = this.spawnPaver();
        }
        let maxInfluxCarts = 0;
        let influxMemory;
        if (this.remoteSpawning) {
            if (this.room.storage && this.room.storage.store.energy < NEED_ENERGY_THRESHOLD
                && this.spawnGroup.room.storage && this.spawnGroup.room.storage.store.energy > SUPPLY_ENERGY_THRESHOLD) {
                maxInfluxCarts = 10;
                influxMemory = { originId: this.spawnGroup.room.storage.id };
            }
        }
        let influxCartBody = () => this.workerBody(0, 25, 25);
        this.influxCarts = this.headCount("influxCart", influxCartBody, () => maxInfluxCarts, { memory: influxMemory, skipMoveToRoom: true });
    }
    missionActions() {
        let index = 0;
        for (let upgrader of this.linkUpgraders) {
            this.linkUpgraderActions(upgrader, index);
            index++;
        }
        if (this.paver) {
            this.paverActions(this.paver);
        }
        if (this.batterySupplyCarts) {
            for (let cart of this.batterySupplyCarts) {
                this.batterySupplyCartActions(cart);
            }
        }
        for (let influxCart of this.influxCarts) {
            this.influxCartActions(influxCart);
        }
        if (this.battery) {
            let startingPosition = this.room.storage;
            if (!startingPosition) {
                startingPosition = this.room.find(FIND_MY_SPAWNS)[0];
            }
            if (startingPosition) {
                this.pavePath(startingPosition, this.battery, 1, true);
            }
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
        if (Math.random() < .01)
            this.memory.positionCount = undefined;
        if (Math.random() < .1)
            this.memory.transportAnalysis = undefined;
    }
    linkUpgraderActions(upgrader, index) {
        let battery = this.room.controller.getBattery();
        if (!battery) {
            upgrader.idleOffRoad(this.flag);
            return; // early
        }
        let outcome;
        if (battery instanceof StructureContainer && battery.hits < battery.hitsMax * 0.8) {
            outcome = upgrader.repair(battery);
        }
        else {
            outcome = upgrader.upgradeController(this.room.controller);
        }
        let myPosition = this.room.controller.getUpgraderPositions()[index];
        if (myPosition) {
            let range = upgrader.pos.getRangeTo(myPosition);
            if (range > 0) {
                upgrader.travelTo(myPosition, { range: 0 });
            }
        }
        else {
            if (upgrader.pos.inRangeTo(battery, 3)) {
                upgrader.yieldRoad(battery);
            }
            else {
                upgrader.travelTo(battery);
            }
        }
        if (upgrader.carry[RESOURCE_ENERGY] < upgrader.carryCapacity / 4) {
            upgrader.withdraw(battery, RESOURCE_ENERGY);
        }
    }
    findControllerBattery() {
        let battery = this.room.controller.getBattery();
        if (battery instanceof StructureContainer && this.room.controller.level >= 5) {
            battery.destroy();
            return;
        }
        if (battery instanceof StructureLink && this.room.controller.level < 5) {
            battery.destroy();
            return;
        }
        if (!battery) {
            let spawn = this.room.find(FIND_MY_SPAWNS)[0];
            if (!spawn)
                return;
            if (!this.memory.batteryPosition) {
                this.memory.batteryPosition = this.findBatteryPosition(spawn);
                if (!this.memory.batteryPosition)
                    return;
            }
            let structureType = STRUCTURE_LINK;
            if (this.room.controller.level < 5) {
                structureType = STRUCTURE_CONTAINER;
            }
            let position = helper.deserializeRoomPosition(this.memory.batteryPosition);
            if (position.lookFor(LOOK_CONSTRUCTION_SITES).length > 0)
                return;
            let outcome = position.createConstructionSite(structureType);
            console.log(`UPGRADE: placing battery in ${this.operation.name}, outcome: ${outcome}, ${position}`);
        }
        return battery;
    }
    findBatteryPosition(spawn) {
        let path = this.findPavedPath(spawn.pos, this.room.controller.pos, 1);
        let positionsInRange = this.room.controller.pos.findInRange(path, 3);
        positionsInRange = _.sortBy(positionsInRange, (pos) => pos.getRangeTo(spawn.pos));
        let mostSpots = 0;
        let bestPositionSoFar;
        for (let position of positionsInRange) {
            let sourcesInRange = position.findInRange(FIND_SOURCES, 2);
            if (sourcesInRange.length > 0)
                continue;
            let openSpotCount = _.filter(position.openAdjacentSpots(true), (pos) => pos.getRangeTo(this.room.controller) <= 3).length;
            if (openSpotCount >= 5)
                return position;
            else if (openSpotCount > mostSpots) {
                mostSpots = openSpotCount;
                bestPositionSoFar = position;
            }
        }
        if (bestPositionSoFar) {
            return bestPositionSoFar;
        }
        else {
            console.log(`couldn't find controller battery position in ${this.operation.name}`);
        }
    }
    batterySupplyCartActions(cart) {
        let controllerBattery = this.battery;
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            cart.procureEnergy(controllerBattery);
            return;
        }
        let rangeToBattery = cart.pos.getRangeTo(controllerBattery);
        if (rangeToBattery > 3) {
            cart.travelTo(controllerBattery);
            return;
        }
        if (controllerBattery.store.energy === controllerBattery.storeCapacity) {
            cart.yieldRoad(controllerBattery);
            return;
        }
        if (rangeToBattery > 1) {
            cart.travelTo(controllerBattery);
            return;
        }
        cart.transfer(controllerBattery, RESOURCE_ENERGY);
    }
    influxCartActions(influxCart) {
        let originStorage = Game.getObjectById(influxCart.memory.originId);
        if (!originStorage) {
            influxCart.idleOffRoad(this.flag);
            return;
        }
        let hasLoad = influxCart.hasLoad();
        if (!hasLoad) {
            if (influxCart.pos.isNearTo(originStorage)) {
                influxCart.withdraw(originStorage, RESOURCE_ENERGY);
                influxCart.travelTo(this.room.storage, { ignoreRoads: true });
            }
            else {
                influxCart.travelTo(originStorage, { ignoreRoads: true });
            }
            return;
        }
        if (influxCart.pos.isNearTo(this.room.storage)) {
            influxCart.transfer(this.room.storage, RESOURCE_ENERGY);
            influxCart.travelTo(originStorage, { ignoreRoads: true });
        }
        else {
            influxCart.travelTo(this.room.storage, { ignoreRoads: true });
        }
    }
    findMaxUpgraders(totalPotency, potencyPerCreep) {
        if (!this.battery)
            return 0;
        if (this.memory.max !== undefined) {
            console.log(`overriding max in ${this.operation.name}`);
            return this.memory.max;
        }
        let max = Math.min(Math.floor(totalPotency / potencyPerCreep), 5);
        if (this.room.controller.getUpgraderPositions()) {
            max = Math.min(this.room.controller.getUpgraderPositions().length, max);
        }
        return max;
    }
    get potencyPerCreep() {
        if (!this._potencyPerCreep) {
            let potencyPerCreep;
            if (this.remoteSpawning) {
                potencyPerCreep = Math.min(this.totalPotency, 23);
            }
            else {
                let unitCost = 125;
                potencyPerCreep = Math.min(Math.floor((this.spawnGroup.maxSpawnEnergy - 200) / unitCost), 30, this.totalPotency);
            }
            this._potencyPerCreep = potencyPerCreep;
        }
        return this._potencyPerCreep;
    }
    get totalPotency() {
        if (!this.battery || this.room.hostiles.length > 0)
            return 0;
        if (!this.memory.potency || Game.time % 10 === 0) {
            if (this.room.controller.level === 8) {
                if (this.room.storage && this.room.storage.store.energy > NEED_ENERGY_THRESHOLD) {
                    return 15;
                }
                else {
                    return 1;
                }
            }
            if (this.room.find(FIND_MY_CONSTRUCTION_SITES).length > 0 &&
                (!this.room.storage || this.room.storage.store.energy < 50000)) {
                return 1;
            }
            let storageCapacity;
            if (this.room.storage) {
                storageCapacity = Math.floor(this.room.storage.store.energy / 1500);
            }
            if (this.battery instanceof StructureLink && this.room.storage) {
                let cooldown = this.battery.pos.getRangeTo(this.room.storage) + 3;
                let linkCount = this.room.storage.pos.findInRange(this.room.findStructures(STRUCTURE_LINK), 2).length;
                return Math.min(Math.floor(((LINK_CAPACITY * .97) * linkCount) / cooldown), storageCapacity);
            }
            else if (this.battery instanceof StructureContainer) {
                if (this.room.storage)
                    return storageCapacity;
                return this.room.find(FIND_SOURCES).length * 10;
            }
            else {
                console.log(`unrecognized controller battery type in ${this.operation.name}, ${this.battery.structureType}`);
                return 0;
            }
        }
        return this.memory.potency;
    }
}

class SeedAnalysis {
    constructor(room, seedData) {
        this.data = seedData;
        this.room = room;
    }
    run(staticStructures, layoutType) {
        let layoutTypes;
        if (layoutType) {
            layoutTypes = [layoutType];
        }
        else {
            layoutTypes = ["quad", "flex"];
        }
        for (let type of layoutTypes) {
            if (!this.data.seedScan[type]) {
                this.findSeeds(type);
            }
            if (this.data.seedScan[type].length > 0) {
                if (staticStructures) {
                    let result = this.findByStructures(type, staticStructures);
                    if (result)
                        return result;
                }
                else {
                    return this.selectSeed(type, this.data.seedScan[type]);
                }
            }
        }
        console.log(`No viable seeds in ${this.room.name}`);
    }
    findSeeds(seedType) {
        let radius;
        let wallMargin;
        let taper;
        if (seedType === "quad") {
            radius = 6;
            wallMargin = 0;
            taper = 1;
        }
        else if (seedType === "flex") {
            radius = 4;
            wallMargin = 1;
            taper = 4;
        }
        let requiredWallOffset = 2;
        let totalMargin = requiredWallOffset + radius + wallMargin;
        if (!this.data.seedScan[seedType]) {
            console.log(`AUTO: initiating seed scan: ${seedType}`);
            this.data.seedScan[seedType] = [];
        }
        let indexX = totalMargin;
        while (indexX <= 49 - totalMargin) {
            let indexY = totalMargin;
            while (indexY <= 49 - totalMargin) {
                let area = this.room.lookForAtArea(LOOK_TERRAIN, indexY - radius, indexX - radius, indexY + radius, indexX + radius);
                let foundSeed = this.checkArea(indexX, indexY, radius, taper, area);
                if (foundSeed) {
                    this.data.seedScan[seedType].push({ x: indexX, y: indexY });
                }
                indexY++;
            }
            indexX++;
        }
        console.log(`found ${this.data.seedScan[seedType].length} ${seedType} seeds`);
        if (this.data.seedScan[seedType].length > 0) {
            this.data.seedScan[seedType] = _.sortBy(this.data.seedScan[seedType], (c) => {
                // sort by distance to controller
                return this.room.controller.pos.getRangeTo(new RoomPosition(c.x, c.y, this.room.name));
            });
        }
    }
    checkArea(xOrigin, yOrigin, radius, taper, area) {
        for (let xDelta = -radius; xDelta <= radius; xDelta++) {
            for (let yDelta = -radius; yDelta <= radius; yDelta++) {
                if (Math.abs(xDelta) + Math.abs(yDelta) > radius * 2 - taper)
                    continue;
                if (area[yOrigin + yDelta][xOrigin + xDelta][0] === "wall") {
                    console.log(`x: ${xOrigin} y: ${yOrigin} disqualified due to wall at ${xOrigin + xDelta}, ${yOrigin + yDelta}`);
                    return false;
                }
            }
        }
        // check source proximity
        let originPosition = new RoomPosition(xOrigin, yOrigin, this.room.name);
        for (let source of this.room.find(FIND_SOURCES)) {
            if (originPosition.inRangeTo(source, radius + 2)) {
                return false;
            }
        }
        return true;
    }
    selectSeed(seedType, seeds) {
        let storageDelta;
        if (seedType === "quad") {
            storageDelta = { x: 0, y: 4 };
        }
        else if (seedType === "flex") {
            storageDelta = { x: 0, y: -3 };
        }
        else {
            console.log("unrecognized seed type");
            return;
        }
        if (!this.data.seedSelectData) {
            this.data.seedSelectData = {
                index: 0,
                rotation: 0,
                best: { seedType: seedType, origin: undefined, rotation: undefined, energyPerDistance: 0 }
            };
        }
        let data = this.data.seedSelectData;
        if (data.rotation > 3) {
            data.index++;
            data.rotation = 0;
        }
        if (data.index >= seeds.length) {
            if (data.best.origin) {
                console.log(`${this.room.name} determined best seed, ${data.best.seedType} at ${data.best.origin.x},${data.best.origin.y} with rotation ${data.rotation}`);
                this.data.seedSelectData = undefined;
                return data.best;
            }
            else {
                console.log(`unable to find suitable seed selection in ${this.room.name}`);
            }
        }
        let storagePosition = helper.coordToPosition(storageDelta, new RoomPosition(seeds[data.index].x, seeds[data.index].y, this.room.name), data.rotation);
        let energyPerDistance = 0;
        for (let sourceDatum of this.data.sourceData) {
            let sourcePosition = helper.deserializeRoomPosition(sourceDatum.pos);
            let ret = PathFinder.search(storagePosition, [{ pos: sourcePosition, range: 1 }], {
                swampCost: 1,
                maxOps: 4000,
            });
            let pathLength = 100;
            if (!ret.incomplete) {
                pathLength = Math.max(ret.path.length, 50);
            }
            energyPerDistance += sourceDatum.amount / pathLength;
        }
        if (energyPerDistance > data.best.energyPerDistance) {
            console.log(`${this.room.name} found better seed, energyPerDistance: ${energyPerDistance}`);
            data.best = { seedType: seedType, origin: seeds[data.index], rotation: data.rotation,
                energyPerDistance: energyPerDistance };
        }
        // update rotation for next tick
        data.rotation++;
    }
    findBySpawn(seedType, spawn) {
        let spawnCoords;
        if (seedType === "quad") {
            spawnCoords = [{ x: 2, y: 0 }, { x: 0, y: -2 }, { x: -2, y: 0 }];
        }
        else { // seedType === "flex"
            spawnCoords = [{ x: -2, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 3 }];
        }
        let seeds = this.data.seedScan[seedType];
        for (let seed of seeds) {
            let centerPosition = new RoomPosition(seed.x, seed.y, this.room.name);
            for (let coord of spawnCoords) {
                for (let rotation = 0; rotation <= 3; rotation++) {
                    let testPosition = helper.coordToPosition(coord, centerPosition, rotation);
                    if (spawn.pos.inRangeTo(testPosition, 0)) {
                        console.log(`seed: ${JSON.stringify(seed)}, centerPos: ${centerPosition}, rotation: ${rotation},` +
                            `\ncoord: ${JSON.stringify(coord)} testPos: ${testPosition}, spawnPos: ${spawn.pos}`);
                        return { seedType: seedType, origin: seed, rotation: rotation, energyPerDistance: undefined };
                    }
                }
            }
        }
    }
    findByStructures(seedType, staticStructures) {
        let mostHits = 0;
        let bestSeed;
        let bestRotation;
        let seeds = this.data.seedScan[seedType];
        for (let seed of seeds) {
            let centerPosition = new RoomPosition(seed.x, seed.y, this.room.name);
            for (let rotation = 0; rotation <= 3; rotation++) {
                let structureHits = 0;
                for (let structureType of [STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_LAB, STRUCTURE_TERMINAL]) {
                    let coords = staticStructures[structureType];
                    for (let coord of coords) {
                        let testPosition = helper.coordToPosition(coord, centerPosition, rotation);
                        if (testPosition.lookForStructure(structureType)) {
                            structureHits++;
                        }
                    }
                }
                if (structureHits > mostHits) {
                    mostHits = structureHits;
                    bestSeed = seed;
                    bestRotation = rotation;
                }
            }
        }
        if (mostHits > 0) {
            return { seedType: seedType, origin: bestSeed, rotation: bestRotation, energyPerDistance: undefined };
        }
    }
}

class Guru {
    constructor(operation, name) {
        this.operation = operation;
        this.flag = operation.flag;
        this.room = operation.room;
        this.spawnGroup = operation.spawnGroup;
        if (!operation.memory[name]) {
            operation.memory[name] = {};
        }
        this.memory = operation.memory[name];
    }
    observeRoom(roomName) {
        let room = Game.rooms[roomName];
        if (room)
            return room;
        let observer = this.spawnGroup.room.findStructures(STRUCTURE_OBSERVER)[0];
        if (!observer) {
            return;
        }
        observer.observeRoom(this.flag.pos.roomName);
    }
    static deserializePositions(stringified, roomName) {
        let roomPositions = [];
        if (!roomName)
            return;
        for (let i = 0; i < stringified.length; i += 4) {
            let x = parseInt(stringified.substr(i, 2));
            let y = parseInt(stringified.substr(i + 2, 2));
            roomPositions.push(new RoomPosition(x, y, roomName));
        }
        return roomPositions;
    }
    static deserializePositionWithIndex(stringified, roomName, index) {
        let x = parseInt(stringified.substr(index, 2));
        let y = parseInt(stringified.substr(index + 2, 2));
        return new RoomPosition(x, y, roomName);
    }
    static serializePositions(positions) {
        let stringified = "";
        for (let position of positions) {
            let x = position.x > 9 ? position.x.toString() : "0" + position.x;
            let y = position.y > 9 ? position.y.toString() : "0" + position.y;
            stringified += x + y;
        }
        return stringified;
    }
}

const SANDBAG_THRESHOLD = 1000000;
class MasonMission extends Mission {
    constructor(operation, defenseGuru) {
        super(operation, "mason");
        this.maxMasons = () => {
            return this.needMason ? Math.ceil(this.room.storage.store.energy / 500000) : 0;
        };
        this.maxCarts = () => {
            if (this.needMason && this.defenseGuru.hostiles.length > 0) {
                return 1;
            }
            else {
                return 0;
            }
        };
        this.defenseGuru = defenseGuru;
    }
    initMission() {
    }
    roleCall() {
        let boosts;
        let allowUnboosted = true;
        if (this.defenseGuru.hostiles.length > 0) {
            boosts = [RESOURCE_CATALYZED_LEMERGIUM_ACID];
            allowUnboosted = !(this.room.terminal && this.room.terminal.store[RESOURCE_CATALYZED_LEMERGIUM_ACID] > 1000);
        }
        this.masons = this.headCount("mason", () => this.workerBody(16, 8, 12), this.maxMasons, {
            boosts: boosts,
            allowUnboosted: allowUnboosted,
            prespawn: 1
        });
        this.carts = this.headCount("masonCart", () => this.workerBody(0, 4, 2), this.maxCarts);
    }
    missionActions() {
        for (let mason of this.masons) {
            if (this.defenseGuru.hostiles.length > 0) {
                this.sandbagActions(mason);
            }
            else {
                this.masonActions(mason);
            }
        }
        for (let cart of this.carts) {
            this.masonCartActions(cart);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
        this.memory.needMason = undefined;
    }
    masonActions(agent) {
        let rampart = this.getRampart(agent);
        if (!rampart) {
            agent.idleOffRoad();
            return;
        }
        agent.creep.repair(rampart);
        let stolen = false;
        if (!agent.isFull(200)) {
            stolen = agent.stealNearby(STRUCTURE_EXTENSION) === OK;
        }
        if (agent.isFull(300) || stolen) {
            agent.idleNear(rampart, 3, true);
            return;
        }
        else {
            let extension = this.getExtension(agent, rampart);
            let outcome = agent.retrieve(extension, RESOURCE_ENERGY);
            if (outcome === OK && !agent.creep.pos.inRangeTo(rampart, 3)) {
                agent.travelTo(rampart);
            }
        }
    }
    sandbagActions(agent) {
        if (agent.creep.ticksToLive > 400 &&
            !agent.creep.body.find((p) => p.boost === RESOURCE_CATALYZED_LEMERGIUM_ACID)) {
            if (this.room.terminal && this.room.terminal.store[RESOURCE_CATALYZED_LEMERGIUM_ACID] > 1000) {
                agent.resetPrep();
            }
        }
        let construction = this.findConstruction(agent);
        if (construction) {
            agent.travelToAndBuild(construction);
            return;
        }
        let emergencySandbag = this.getEmergencySandbag(agent);
        if (emergencySandbag) {
            if (agent.pos.inRangeTo(emergencySandbag, 3)) {
                agent.creep.repair(emergencySandbag);
            }
            else {
                agent.travelTo(emergencySandbag);
            }
        }
    }
    masonCartActions(agent) {
        let lowestMason = _(this.masons).sortBy((a) => a.creep.carry.energy).head();
        if (!lowestMason || !this.room.storage) {
            agent.idleOffRoad();
            return;
        }
        if (agent.isFull()) {
            let outcome = agent.deliver(lowestMason.creep, RESOURCE_ENERGY);
            if (outcome === OK) {
                agent.travelTo(this.room.storage);
            }
        }
        else {
            let outcome = agent.retrieve(this.room.storage, RESOURCE_ENERGY);
            if (outcome === OK) {
                agent.travelTo(lowestMason);
            }
        }
    }
    get needMason() {
        if (!this.memory.needMason) {
            if (this.room.controller.level < 8) {
                this.memory.needMason = false;
            }
            else {
                const MIN_RAMPART_HITS = 50000000;
                let lowestRampart = _(this.room.findStructures(STRUCTURE_RAMPART)).sortBy("hits").head();
                this.memory.needMason = lowestRampart && lowestRampart.hits < MIN_RAMPART_HITS;
            }
        }
        return this.memory.needMason;
    }
    get sandbags() {
        if (!this._sandbags) {
            if (!this.memory.sandbags) {
                let sandbags = this.findSandbags();
                this.memory.sandbags = Guru.serializePositions(sandbags);
            }
            this._sandbags = Guru.deserializePositions(this.memory.sandbags, this.room.name);
        }
        return this._sandbags;
    }
    getEmergencySandbag(agent) {
        let emergencyThreshold = SANDBAG_THRESHOLD / 10;
        let nextConstruction = [];
        for (let sandbag of this.sandbags) {
            let rampart = sandbag.lookForStructure(STRUCTURE_RAMPART);
            if (rampart && rampart.hits < emergencyThreshold) {
                return rampart;
            }
            if (!rampart) {
                nextConstruction.push(sandbag);
            }
        }
        if (this.room.find(FIND_CONSTRUCTION_SITES).length > 0) {
            return;
        }
        let bestPosition = agent.pos.findClosestByRange(this.defenseGuru.hostiles).pos.findClosestByRange(nextConstruction);
        if (bestPosition) {
            bestPosition.createConstructionSite(STRUCTURE_RAMPART);
        }
    }
    findSandbags() {
        let leftBound = 50;
        let rightBound = 0;
        let topBound = 50;
        let bottomBound = 0;
        let wallRamparts = [];
        for (let rampart of this.room.findStructures(STRUCTURE_RAMPART)) {
            if (rampart.pos.lookForStructure(STRUCTURE_ROAD))
                continue;
            if (rampart.pos.lookForStructure(STRUCTURE_EXTENSION))
                continue;
            wallRamparts.push(rampart);
            if (rampart.pos.x < leftBound) {
                leftBound = rampart.pos.x;
            }
            if (rampart.pos.x > rightBound) {
                rightBound = rampart.pos.x;
            }
            if (rampart.pos.y < topBound) {
                topBound = rampart.pos.y;
            }
            if (rampart.pos.y > bottomBound) {
                bottomBound = rampart.pos.y;
            }
        }
        console.log(leftBound, rightBound, topBound, bottomBound);
        let sandbags = [];
        for (let structure of this.room.find(FIND_STRUCTURES)) {
            if (structure.structureType === STRUCTURE_RAMPART)
                continue;
            if (structure.pos.lookForStructure(STRUCTURE_RAMPART))
                continue;
            let nearbyRampart = structure.pos.findInRange(wallRamparts, 2)[0];
            if (!nearbyRampart)
                continue;
            if (structure.pos.x < leftBound || structure.pos.x > rightBound)
                continue;
            if (structure.pos.y < topBound || structure.pos.y > bottomBound)
                continue;
            sandbags.push(structure.pos);
        }
        return sandbags;
    }
    getRampart(agent) {
        let findRampart = () => {
            let lowestHits = 100000;
            let lowestRampart = _(this.room.findStructures(STRUCTURE_RAMPART)).sortBy("hits").head();
            if (lowestRampart) {
                lowestHits = lowestRampart.hits;
            }
            let myRampart = _(this.room.findStructures(STRUCTURE_RAMPART))
                .filter((s) => s.hits < lowestHits + 100000)
                .sortBy((s) => agent.pos.getRangeTo(s))
                .head();
            if (myRampart)
                return myRampart;
        };
        let forgetRampart = (s) => agent.creep.ticksToLive % 500 === 0;
        return agent.rememberStructure(findRampart, forgetRampart, "rampartId");
    }
    getExtension(agent, rampart) {
        let fullExtensions = _.filter(this.room.findStructures(STRUCTURE_EXTENSION), (e) => e.energy > 0);
        let extension = rampart.pos.findClosestByRange(fullExtensions);
        return agent.pos.findClosestByRange([this.room.storage, extension]);
    }
    findConstruction(agent) {
        return agent.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
    }
}

class BodyguardMission extends Mission {
    /**
     * Remote defense for non-owned rooms. If boosted invaders are likely, use EnhancedBodyguardMission
     * @param operation
     * @param invaderGuru
     * @param allowSpawn
     */
    constructor(operation, invaderGuru, allowSpawn = true) {
        super(operation, "bodyguard", allowSpawn);
        this.getBody = () => {
            let unit = this.configBody({
                tough: 1,
                move: 5,
                attack: 3,
                heal: 1
            });
            let potency = Math.min(this.spawnGroup.maxUnits(unit, 1), 3);
            return this.configBody({
                tough: potency,
                move: potency * 5,
                attack: potency * 3,
                heal: potency
            });
        };
        this.maxDefenders = () => {
            let maxDefenders = 0;
            if (this.invaderGuru && this.invaderGuru.invaderProbable) {
                maxDefenders = 1;
            }
            if (this.hasVision) {
                if (this.hostiles.length > 0) {
                    maxDefenders = Math.ceil(this.hostiles.length / 2);
                }
                if (this.operation.type !== "mining" && this.room.findStructures(STRUCTURE_TOWER).length === 0) {
                    maxDefenders = 1;
                }
            }
            return maxDefenders;
        };
        this.invaderGuru = invaderGuru;
    }
    initMission() {
        if (!this.hasVision)
            return; // early
        this.hostiles = this.room.hostiles;
    }
    roleCall() {
        this.defenders = this.headCount("leeroy", this.getBody, this.maxDefenders, { prespawn: 50 });
    }
    missionActions() {
        for (let defender of this.defenders) {
            this.defenderActions(defender);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    defenderActions(defender) {
        if (!this.hasVision || this.hostiles.length === 0) {
            if (defender.hits < defender.hitsMax) {
                defender.heal(defender);
            }
            else {
                this.medicActions(defender);
            }
            return; // early
        }
        let attacking = false;
        let closest = defender.pos.findClosestByRange(this.hostiles);
        if (closest) {
            let range = defender.pos.getRangeTo(closest);
            if (range > 1) {
                defender.travelTo(closest);
            }
            else {
                attacking = defender.attack(closest) === OK;
                defender.move(defender.pos.getDirectionTo(closest));
            }
        }
        else {
            defender.travelTo(this.hostiles[0]);
        }
        if (!attacking && defender.hits < defender.hitsMax) {
            defender.heal(defender);
        }
    }
}

class RemoteBuildMission extends Mission {
    /**
     * Builds construction in remote locations, can recycle self when finished
     * @param operation
     * @param recycleWhenDone - recycles creep in spawnroom if there are no available construction sites
     * @param allowSpawn
     */
    constructor(operation, recycleWhenDone, allowSpawn = true) {
        super(operation, "remoteBuild");
        this.recycleWhenDone = recycleWhenDone;
        this.allowSpawn = allowSpawn;
    }
    initMission() {
        if (!this.hasVision) {
            return; // early
        }
        this.construction = this.room.find(FIND_MY_CONSTRUCTION_SITES);
    }
    roleCall() {
        let maxBuilders = () => this.construction && this.construction.length > 0 ? 1 : 0;
        let getBody = () => {
            return this.bodyRatio(1, 1, 1, .8, 10);
        };
        let memory;
        if (this.memory.activateBoost || (this.room.controller && this.room.controller.my)) {
            memory = { boosts: [RESOURCE_CATALYZED_LEMERGIUM_ACID], allowUnboosted: true };
        }
        this.builders = this.headCount("remoteBuilder", getBody, maxBuilders, { memory: memory });
    }
    missionActions() {
        for (let builder of this.builders) {
            if (!this.waypoints && this.recycleWhenDone && this.construction.length === 0) {
                this.recycleBuilder(builder);
            }
            else {
                this.builderActions(builder);
            }
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    builderActions(builder) {
        let fleeing = builder.fleeHostiles();
        if (fleeing)
            return; // early
        if (!this.hasVision) {
            if (!builder.pos.isNearTo(this.flag)) {
                builder.travelTo(this.flag);
            }
            return; // early
        }
        builder.stealNearby("creep");
        let hasLoad = builder.hasLoad();
        if (!hasLoad) {
            builder.procureEnergy(undefined, true, true);
            return; // early
        }
        let closest = this.findConstruction(builder);
        if (!closest) {
            builder.idleNear(this.flag);
            return; // early
        }
        if (builder.pos.inRangeTo(closest, 3)) {
            builder.build(closest);
            builder.yieldRoad(closest);
        }
        else {
            builder.travelTo(closest);
        }
    }
    recycleBuilder(builder) {
        let spawn = this.spawnGroup.spawns[0];
        if (builder.carry.energy > 0 && spawn.room.storage) {
            if (builder.pos.isNearTo(spawn.room.storage)) {
                builder.transfer(spawn.room.storage, RESOURCE_ENERGY);
            }
            else {
                builder.travelTo(spawn.room.storage);
            }
        }
        else {
            let spawn = this.spawnGroup.spawns[0];
            if (builder.pos.isNearTo(spawn)) {
                spawn.recycleCreep(builder.creep);
            }
            else {
                builder.travelTo(spawn);
            }
        }
    }
    findConstruction(builder) {
        if (builder.memory.siteId) {
            let site = Game.getObjectById(builder.memory.siteId);
            if (site) {
                return site;
            }
            else {
                delete builder.memory.siteId;
                return this.findConstruction(builder);
            }
        }
        else {
            let site = builder.pos.findClosestByRange(this.construction);
            if (site) {
                builder.memory.siteId = site.id;
                return site;
            }
        }
    }
}

class ScoutMission extends Mission {
    constructor(operation) {
        super(operation, "scout");
    }
    initMission() {
    }
    roleCall() {
        let maxScouts = () => this.hasVision ? 0 : 1;
        this.scouts = this.headCount(this.name, () => this.workerBody(0, 0, 1), maxScouts, { blindSpawn: true });
    }
    missionActions() {
        for (let scout of this.scouts) {
            if (!scout.pos.isNearTo(this.flag)) {
                scout.avoidSK(this.flag);
            }
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
}

class ClaimMission extends Mission {
    constructor(operation) {
        super(operation, "claimer");
        this.getMax = () => (this.controller && !this.controller.my) || !this.hasVision ? 1 : 0;
    }
    initMission() {
        //if (!this.hasVision) return; // early
        if (this.room) {
            this.controller = this.room.controller;
        }
    }
    roleCall() {
        this.claimers = this.headCount("claimer", () => [CLAIM, MOVE], this.getMax, { blindSpawn: true });
    }
    missionActions() {
        for (let claimer of this.claimers) {
            this.claimerActions(claimer);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    claimerActions(claimer) {
        console.log(`ey`);
        if (!this.controller) {
            claimer.idleOffRoad();
            return; // early
        }
        if (claimer.pos.isNearTo(this.controller)) {
            claimer.claimController(this.controller);
        }
        else {
            claimer.travelTo(this.controller);
        }
    }
}

class SurveyAnalyzer {
    constructor(mission) {
        this.room = mission.room;
        this.spawnGroup = mission.spawnGroup;
        this.memory = mission.memory;
        this.opName = mission.operation.name;
    }
    run() {
        // place flag in chosen missionRoom
        if (Game.time < this.memory.nextAnalysis) {
            return;
        }
        if (this.memory.chosenRoom) {
            let room = Game.rooms[this.memory.chosenRoom];
            if (room) {
                this.placeFlag(room);
                delete this.memory.chosenRoom;
                if (Object.keys(this.memory.surveyRooms).length === 0) {
                    notifier.log(`SURVEY: no more rooms to evaluate in ${this.room.name}`);
                }
                else {
                    this.memory.nextAnalysis = Game.time + 1000;
                }
            }
            return this.memory.chosenRoom;
        }
        // analyze rooms
        let exploreRoomName;
        if (!this.memory.surveyRooms) {
            this.memory.surveyRooms = this.initSurveyData();
        }
        exploreRoomName = this.completeSurveyData(this.memory.surveyRooms);
        if (exploreRoomName)
            return exploreRoomName;
        exploreRoomName = this.updateOwnershipData();
        if (exploreRoomName)
            return;
        let chosenRoom;
        let readyList = this.checkReady();
        if (readyList && Object.keys(readyList).length > 0) {
            chosenRoom = this.chooseRoom(readyList);
        }
        if (chosenRoom) {
            this.memory.chosenRoom = chosenRoom;
        }
        else if (this.memory.nextAnalysis < Game.time) {
            this.memory.nextAnalysis = Game.time + 1000;
        }
    }
    initSurveyData() {
        let data = {};
        // find core
        let roomCoords = WorldMap.getRoomCoordinates(this.room.name);
        let coreX = "" + Math.floor(roomCoords.x / 10) + 5;
        let coreY = "" + Math.floor(roomCoords.y / 10) + 5;
        let nearestCore = roomCoords.xDir + coreX + roomCoords.yDir + coreY;
        if (Game.map.getRoomLinearDistance(this.room.name, nearestCore) <= 2 &&
            this.spawnGroup.averageAvailability > 1.5) {
            data[nearestCore] = { danger: true };
        }
        let adjacentRoomNames = this.findAdjacentRooms(this.room.name, 1, [ROOMTYPE_ALLEY]);
        for (let roomName of adjacentRoomNames) {
            let noSafePath = false;
            let roomsInPath = empire.traveler.findRoute(this.room.name, roomName, { allowHostile: true, restrictDistance: 1 });
            if (roomsInPath) {
                for (let roomName in roomsInPath) {
                    if (Traveler.checkOccupied(roomName)) {
                        noSafePath = true;
                    }
                }
            }
            else {
                noSafePath = true;
            }
            let type = WorldMap.roomTypeFromName(roomName);
            if (type === ROOMTYPE_SOURCEKEEPER || noSafePath) {
                data[roomName] = { danger: true };
            }
            else {
                data[roomName] = { danger: false };
            }
        }
        return data;
    }
    findAdjacentRooms(startRoomName, distance = 1, filterOut = []) {
        let alreadyChecked = { [startRoomName]: true };
        let adjacentRooms = [];
        let testRooms = [startRoomName];
        while (testRooms.length > 0) {
            let testRoom = testRooms.pop();
            alreadyChecked[testRoom] = true;
            for (let value of _.values(Game.map.describeExits(testRoom))) {
                if (alreadyChecked[value])
                    continue;
                if (Game.map.getRoomLinearDistance(startRoomName, value) > distance)
                    continue;
                if (_.includes(filterOut, WorldMap.roomTypeFromName(value)))
                    continue;
                adjacentRooms.push(value);
                testRooms.push(value);
                alreadyChecked[value] = true;
            }
        }
        return adjacentRooms;
    }
    completeSurveyData(surveyRooms) {
        for (let roomName in surveyRooms) {
            let data = surveyRooms[roomName];
            if (data.sourceCount)
                continue;
            let room = Game.rooms[roomName];
            if (room) {
                this.analyzeRoom(room, data);
                continue;
            }
            if (!data.danger) {
                return roomName;
            }
            else {
                if (this.room.controller.level < 8)
                    continue;
                return roomName;
            }
        }
    }
    analyzeRoom(room, data) {
        // mineral
        if (!room.controller) {
            data.mineralType = room.find(FIND_MINERALS)[0].mineralType;
        }
        // owner
        data.owner = this.checkOwnership(room);
        data.lastCheckedOwner = Game.time;
        if (data.owner === USERNAME) {
            delete this.memory.surveyRooms[room.name];
            return;
        }
        // source info
        let roomDistance = Game.map.getRoomLinearDistance(this.room.name, room.name);
        let sources = room.find(FIND_SOURCES);
        let roomType = WorldMap.roomTypeFromName(room.name);
        let distances = [];
        data.sourceCount = sources.length;
        for (let source of sources) {
            let ret = PathFinder.search(this.room.storage.pos, { pos: source.pos, range: 1 }, {
                swampCost: 1,
                plainCost: 1,
                roomCallback: (roomName) => {
                    if (Game.map.getRoomLinearDistance(this.room.name, roomName) > roomDistance) {
                        return false;
                    }
                }
            });
            if (ret.incomplete) {
                notifier.log(`SURVEY: Incomplete path from ${this.room.storage.pos} to ${source.pos}`);
            }
            let distance = ret.path.length;
            distances.push(distance);
            let cartsNeeded = Mission.analyzeTransport(distance, Mission.loadFromSource(source), 12900).cartsNeeded;
            // disqualify due to source distance
            if (cartsNeeded > data.sourceCount) {
                notifier.log(`SURVEY: disqualified ${room.name} due to distance to source: ${cartsNeeded}`);
                delete this.memory.surveyRooms[room.name];
                return;
            }
        }
        data.averageDistance = _.sum(distances) / distances.length;
        // walls
        data.hasWalls = room.findStructures(STRUCTURE_WALL).length > 0;
    }
    checkOwnership(room) {
        let flags = room.find(FIND_FLAGS);
        for (let flag of flags) {
            if (flag.name.indexOf("mining") >= 0 || flag.name.indexOf("keeper") >= 0) {
                return USERNAME;
            }
        }
        if (room.controller) {
            if (room.controller.reservation) {
                return room.controller.reservation.username;
            }
            else if (room.controller.owner) {
                return room.controller.owner.username;
            }
        }
        else {
            for (let source of room.find(FIND_SOURCES)) {
                let nearbyCreeps = _.filter(source.pos.findInRange(FIND_CREEPS, 1), (c) => !c.owner || c.owner.username !== "Source Keeper");
                if (nearbyCreeps.length === 0) {
                    continue;
                }
                return nearbyCreeps[0].owner.username;
            }
        }
    }
    updateOwnershipData() {
        for (let roomName in this.memory.surveyRooms) {
            let data = this.memory.surveyRooms[roomName];
            // owner
            if (Game.time > data.lastCheckedOwner + 10000) {
                let room = Game.rooms[roomName];
                if (room) {
                    data.owner = this.checkOwnership(room);
                    if (data.owner === USERNAME) {
                        delete this.memory.surveyRooms[room.name];
                    }
                    else {
                        data.lastCheckedOwner = Game.time;
                    }
                }
                else {
                    return roomName;
                }
            }
        }
    }
    checkReady() {
        if (!empire.underCPULimit()) {
            notifier.log(`SURVEY: avoiding placement, cpu is over limit`);
            this.memory.nextAnalysis = Game.time + 10000;
            return;
        }
        let readyList = {};
        for (let roomName in this.memory.surveyRooms) {
            let data = this.memory.surveyRooms[roomName];
            // owner
            if (!data.sourceCount) {
                continue;
            }
            // don't claim rooms if any nearby rooms with another owner
            if (data.owner) {
                return;
            }
            // spawning availability
            let availabilityRequired = this.spawnGroup.spawns.length / 3;
            if (Game.map.getRoomLinearDistance(this.room.name, roomName) > 1) {
                availabilityRequired = 1.2;
            }
            if (this.spawnGroup.averageAvailability < availabilityRequired) {
                continue;
            }
            readyList[roomName] = data;
        }
        return readyList;
    }
    chooseRoom(readySurveyRooms) {
        let bestScore = 0;
        let bestChoice;
        for (let roomName in readySurveyRooms) {
            let data = readySurveyRooms[roomName];
            let score = data.sourceCount * 1000 - data.averageDistance;
            if (score > bestScore) {
                bestChoice = roomName;
                bestScore = score;
            }
        }
        return bestChoice;
    }
    placeFlag(room) {
        let direction = WorldMap.findRelativeRoomDir(this.room.name, room.name);
        let opName = this.opName.substr(0, this.opName.length - 1) + direction;
        if (Game.map.getRoomLinearDistance(this.room.name, room.name) > 1) {
            opName += direction;
        }
        let opType = "mining";
        if (room.roomType === ROOMTYPE_SOURCEKEEPER) {
            opType = "keeper";
        }
        let flagName = `${opType}_${opName}`;
        helper.pathablePosition(room.name).createFlag(flagName, COLOR_GREY);
        notifier.log(`SURVEY: created new operation in ${room.name}: ${flagName}`);
        delete this.memory.surveyRooms[room.name];
    }
}

class SurveyMission extends Mission {
    constructor(operation) {
        super(operation, "survey");
        this.maxSurveyors = () => {
            if (this.needsVision && !this.room.findStructures(STRUCTURE_OBSERVER)[0] || this.chosenRoom) {
                return 1;
            }
            else {
                return 0;
            }
        };
    }
    initMission() {
        if (this.memory.surveyComplete) {
            return;
        }
        let analyzer = new SurveyAnalyzer(this);
        this.needsVision = analyzer.run();
    }
    roleCall() {
        this.surveyors = this.headCount("surveyor", () => this.workerBody(0, 0, 1), this.maxSurveyors);
    }
    missionActions() {
        for (let surveyor of this.surveyors) {
            if (this.needsVision) {
                this.explorerActions(surveyor);
            }
        }
        if (this.needsVision) {
            let observer = this.room.findStructures(STRUCTURE_OBSERVER)[0];
            if (!observer) {
                return;
            }
            observer.observeRoom(this.needsVision);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    explorerActions(explorer) {
        if (this.needsVision) {
            explorer.travelTo({ pos: helper.pathablePosition(this.needsVision) });
        }
    }
}

class DefenseMission extends Mission {
    constructor(operation) {
        super(operation, "defense");
        this.healers = [];
        this.attackers = [];
        this.enemySquads = [];
        this.getMaxDefenders = () => this.playerThreat ? Math.max(this.enemySquads.length, 1) : 0;
        this.getMaxRefillers = () => this.playerThreat ? 1 : 0;
        this.defenderBody = () => {
            if (this.enhancedBoost) {
                let bodyUnit = this.configBody({ [TOUGH]: 1, [ATTACK]: 3, [MOVE]: 1 });
                let maxUnits = Math.min(this.spawnGroup.maxUnits(bodyUnit), 8);
                return this.configBody({ [TOUGH]: maxUnits, [ATTACK]: maxUnits * 3, [RANGED_ATTACK]: 1, [MOVE]: maxUnits + 1 });
            }
            else {
                let bodyUnit = this.configBody({ [TOUGH]: 1, [ATTACK]: 5, [MOVE]: 6 });
                let maxUnits = Math.min(this.spawnGroup.maxUnits(bodyUnit), 4);
                return this.configBody({ [TOUGH]: maxUnits, [ATTACK]: maxUnits * 5, [MOVE]: maxUnits * 6 });
            }
        };
        this.preferRamparts = (roomName, matrix) => {
            if (roomName === this.room.name) {
                // block off hostiles and adjacent squares
                for (let hostile of this.room.hostiles) {
                    matrix.set(hostile.pos.x, hostile.pos.y, 0xff);
                    for (let i = 1; i <= 8; i++) {
                        let position = hostile.pos.getPositionAtDirection(i);
                        matrix.set(position.x, position.y, 0xff);
                    }
                }
                // set rampart costs to same as road
                for (let rampart of this.wallRamparts) {
                    matrix.set(rampart.pos.x, rampart.pos.y, 1);
                }
                return matrix;
            }
        };
    }
    initMission() {
        this.towers = this.room.findStructures(STRUCTURE_TOWER);
        this.analyzePlayerThreat();
        // nuke detection
        if (Game.time % 1000 === 1) {
            let nukes = this.room.find(FIND_NUKES);
            for (let nuke of nukes) {
                console.log(`DEFENSE: nuke landing at ${this.operation.name} in ${nuke.timeToLand}`);
            }
        }
        // only gets triggered if a wall is breached
        this.triggerSafeMode();
    }
    roleCall() {
        this.refillCarts = this.headCount("towerCart", () => this.bodyRatio(0, 2, 1, 1, 4), this.getMaxRefillers);
        let memory = { boosts: [RESOURCE_CATALYZED_KEANIUM_ALKALIDE, RESOURCE_CATALYZED_GHODIUM_ALKALIDE,
                RESOURCE_CATALYZED_UTRIUM_ACID], allowUnboosted: !this.enhancedBoost };
        if (this.enhancedBoost) {
            memory.boosts.push(RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE);
        }
        this.defenders = this.headCount("defender", this.defenderBody, this.getMaxDefenders, { prespawn: 1, memory: memory });
    }
    missionActions() {
        let order = 0;
        for (let defender of this.defenders) {
            this.defenderActions(defender, order);
            order++;
        }
        this.towerTargeting(this.towers);
        for (let cart of this.refillCarts) {
            this.towerCartActions(cart);
        }
    }
    finalizeMission() {
    }
    invalidateMissionCache() {
    }
    towerCartActions(cart) {
        let hasLoad = cart.hasLoad();
        if (!hasLoad) {
            cart.procureEnergy(this.findLowestEmpty(cart), true);
            return;
        }
        let target = this.findLowestEmpty(cart);
        if (!target) {
            cart.memory.hasLoad = cart.carry.energy === cart.carryCapacity;
            cart.yieldRoad(this.flag);
            return;
        }
        // has target
        if (!cart.pos.isNearTo(target)) {
            cart.travelTo(target);
            return;
        }
        // is near to target
        let outcome = cart.transfer(target, RESOURCE_ENERGY);
        if (outcome === OK && cart.carry.energy >= target.energyCapacity) {
            target = this.findLowestEmpty(cart, target);
            if (target && !cart.pos.isNearTo(target)) {
                cart.travelTo(target);
            }
        }
    }
    findLowestEmpty(cart, pullTarget) {
        if (!this.empties) {
            this.empties = _(this.towers)
                .filter((s) => s.energy < s.energyCapacity)
                .sortBy("energy")
                .value();
        }
        if (pullTarget) {
            _.pull(this.empties, pullTarget);
        }
        return this.empties[0];
    }
    defenderActions(defender, order) {
        if (this.enemySquads.length === 0) {
            defender.idleOffRoad();
            defender.say("none :(");
            return; // early
        }
        if (this.memory.unleash) {
            let closest = defender.pos.findClosestByRange(this.room.hostiles);
            if (defender.pos.isNearTo(closest)) {
                if (defender.attack(closest) === OK) {
                    this.attackedCreep = closest;
                }
            }
            else {
                let outcome = defender.travelTo(closest);
            }
        }
        else {
            let target = defender.pos.findClosestByRange(this.enemySquads[order % this.enemySquads.length]);
            if (!target) {
                console.log("no target");
                return;
            }
            let closestRampart = target.pos.findClosestByRange(this.jonRamparts);
            if (closestRampart) {
                let currentRampart = defender.pos.lookForStructure(STRUCTURE_RAMPART);
                if (currentRampart && currentRampart.pos.getRangeTo(target) <= closestRampart.pos.getRangeTo(target)) {
                    closestRampart = currentRampart;
                }
                _.pull(this.jonRamparts, closestRampart);
                defender.travelTo(closestRampart, { roomCallback: this.preferRamparts });
            }
            else {
                defender.idleOffRoad(this.flag);
            }
            // attack
            if (defender.pos.isNearTo(target)) {
                if (defender.attack(target) === OK) {
                    if (!this.attackedCreep || target.hits < this.attackedCreep.hits) {
                        this.attackedCreep = this.closestHostile;
                    }
                }
            }
            else {
                let closeCreep = defender.pos.findInRange(this.room.hostiles, 1)[0];
                if (closeCreep) {
                    if (defender.attack(closeCreep) === OK) {
                        this.attackedCreep = closeCreep;
                    }
                }
            }
        }
        // heal
        if (defender.hits < defender.hitsMax && (!this.healedDefender || defender.hits < this.healedDefender.hits)) {
            this.healedDefender = defender;
        }
    }
    towerTargeting(towers) {
        if (!towers || towers.length === 0)
            return;
        for (let tower of this.towers) {
            let target = this.closestHostile;
            // kill jon snows target
            if (this.attackedCreep) {
                target = this.attackedCreep;
            }
            // healing as needed
            if (this.healedDefender) {
                tower.heal(this.healedDefender.creep);
            }
            // the rest attack
            tower.attack(target);
        }
    }
    triggerSafeMode() {
        if (this.playerThreat && !this.memory.disableSafeMode) {
            let wallCount = this.room.findStructures(STRUCTURE_WALL).concat(this.room.findStructures(STRUCTURE_RAMPART)).length;
            if (this.memory.wallCount && wallCount < this.memory.wallCount) {
                this.room.controller.activateSafeMode();
                this.memory.unleash = true;
            }
            this.memory.wallCount = wallCount;
        }
        else {
            this.memory.wallCount = undefined;
        }
    }
    closeToWall(creep) {
        let wall = Game.getObjectById(this.memory.closestWallId);
        if (wall && creep.pos.isNearTo(wall)) {
            return true;
        }
        else {
            let walls = this.room.findStructures(STRUCTURE_RAMPART);
            for (let wall of walls) {
                if (creep.pos.isNearTo(wall)) {
                    this.memory.closestWallId = wall.id;
                    return true;
                }
            }
        }
    }
    analyzePlayerThreat() {
        if (this.towers.length > 0 && this.room.hostiles.length > 0) {
            this.closestHostile = this.towers[0].pos.findClosestByRange(this.room.hostiles);
        }
        let playerCreeps = _.filter(this.room.hostiles, (c) => {
            return c.owner.username !== "Invader" && c.body.length >= 40 && _.filter(c.body, part => part.boost).length > 0;
        });
        this.playerThreat = playerCreeps.length > 1 || this.memory.preSpawn;
        if (this.playerThreat) {
            if (!Memory.roomAttacks)
                Memory.roomAttacks = {};
            Memory.roomAttacks[playerCreeps[0].owner.username] = Game.time;
            if (Game.time % 10 === 5) {
                console.log("DEFENSE: " + playerCreeps.length + " non-ally hostile creep in owned missionRoom: " + this.flag.pos.roomName);
            }
            for (let creep of this.room.hostiles) {
                if (creep.partCount(HEAL) > 12) {
                    this.healers.push(creep);
                }
                else {
                    this.attackers.push(creep);
                }
            }
            this.likelyTowerDrainAttempt = this.attackers.length === 0;
            this.wallRamparts = _.filter(this.room.findStructures(STRUCTURE_RAMPART), (r) => {
                return _.filter(r.pos.lookFor(LOOK_STRUCTURES), (s) => {
                    return s.structureType !== STRUCTURE_ROAD;
                }).length === 1;
            });
            this.jonRamparts = this.wallRamparts.slice(0);
            // find squads
            let attackers = _.sortBy(this.attackers, (c) => { this.towers[0].pos.getRangeTo(c); });
            while (attackers.length > 0) {
                let squad = attackers[0].pos.findInRange(attackers, 5);
                let nearbyRamparts = attackers[0].pos.findInRange(this.wallRamparts, 10);
                if (this.enemySquads.length === 0 || nearbyRamparts.length > 0) {
                    this.enemySquads.push(squad);
                }
                attackers = _.difference(attackers, squad);
            }
            this.enhancedBoost = this.room.terminal && this.room.terminal.store[RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE] > 1000;
        }
    }
}

class DefenseGuru extends Guru {
    constructor(operation) {
        super(operation, "defenseGuru");
    }
    get hostiles() {
        if (!this._hostiles) {
            this._hostiles = _.filter(this.room.hostiles, (c) => {
                return c.owner.username !== "Invader" && c.body.length >= 40 && _.filter(c.body, part => part.boost).length > 0;
            });
            let fauxHostiles = _.filter(this.room.find(FIND_FLAGS), (f) => f.name.indexOf("faux") >= 0);
            if (fauxHostiles.length > 0) {
                this._hostiles = fauxHostiles;
            }
        }
        return this._hostiles;
    }
}

class ControllerOperation extends Operation {
    constructor(flag, name, type) {
        super(flag, name, type);
        this.priority = OperationPriority.OwnedRoom;
        if (this.flag.room && this.flag.room.controller.level < 6) {
            this.priority = OperationPriority.VeryHigh;
        }
    }
    initOperation() {
        this.autoLayout();
        this.spawnGroup = empire.getSpawnGroup(this.flag.pos.roomName);
        this.initRemoteSpawn(8, 8);
        let remoteSpawning = false;
        if (!this.spawnGroup) {
            remoteSpawning = true;
            if (!this.remoteSpawn) {
                console.log(`${this.name} is unable to spawn, no local or remote spawnGroup`);
                return;
            }
            this.spawnGroup = this.remoteSpawn.spawnGroup;
            this.addMission(new ScoutMission(this));
            this.addMission(new ClaimMission(this));
            if (!this.hasVision || this.room.controller.level === 0)
                return; // vision can be assumed after this point
        }
        this.addMission(new RemoteBuildMission(this, false, remoteSpawning));
        if (this.room.controller.level < 3 && this.room.findStructures(STRUCTURE_TOWER).length === 0 && remoteSpawning) {
            this.addMission(new BodyguardMission(this));
        }
        if (this.flag.room.findStructures(STRUCTURE_SPAWN).length > 0) {
            // spawn emergency miner if needed
            this.addMission(new EmergencyMinerMission(this));
            // refill spawning energy - will spawn small spawnCart if needed
            this.addMission(new RefillMission(this));
        }
        let defenseGuru = new DefenseGuru(this);
        this.addMission(new DefenseMission(this));
        //this.addMission(new PowerMission(this));
        // energy network
        if (this.flag.room.terminal && this.flag.room.storage && this.flag.room.controller.level >= 6) ;
        // harvest energy
        for (let i = 0; i < this.sources.length; i++) {
            if (this.sources[i].pos.lookFor(LOOK_FLAGS).length > 0)
                continue;
            let source = this.sources[i];
            if (this.flag.room.controller.level === 8 && this.flag.room.storage) {
                let link = source.findMemoStructure(STRUCTURE_LINK, 2, true);
                if (link) {
                    this.addMission(new LinkMiningMission(this, "miner" + i, source, link));
                    continue;
                }
                else {
                    this.placeLink(source);
                }
            }
            this.addMission(new MiningMission(this, "miner" + i, source));
        }
        // build construction
        let buildMission = new BuilderMission(this, defenseGuru);
        this.addMission(buildMission);
        if (this.flag.room.storage) {
            // use link array near storage to fire energy at controller link (pre-rcl8)
            // this.addMission(new LinkNetworkMission(this));
            // mine minerals
            this.addMission(new GeologyMission(this));
            // scout and place harvest flags
            this.addMission(new SurveyMission(this));
            // repair walls
            this.addMission(new MasonMission(this, defenseGuru));
        }
        // upgrader controller
        let boostUpgraders = this.flag.room.controller.level < 8;
        let upgradeMission = new UpgradeMission(this, boostUpgraders);
        this.addMission(upgradeMission);
        // upkeep roads and walls
        this.towerRepair();
    }
    finalizeOperation() {
    }
    invalidateOperationCache() {
    }
    nuke(x, y, roomName) {
        let nuker = _.head(this.flag.room.find(FIND_MY_STRUCTURES, { filter: { structureType: STRUCTURE_NUKER } }));
        let outcome = nuker.launchNuke(new RoomPosition(x, y, roomName));
        if (outcome === OK) {
            empire.map.addNuke({ tick: Game.time, roomName: roomName });
            return "NUKER: Bombs away! \\o/";
        }
        else {
            return `NUKER: error: ${outcome}`;
        }
    }
    moveLayout(x, y, rotation) {
        this.memory.centerPosition = new RoomPosition(x, y, this.flag.pos.roomName);
        this.memory.rotation = rotation;
        this.memory.layoutMap = undefined;
        this.showLayout(false);
        return `moving layout, run command ${this.name}.showLayout(true) to display`;
    }
    showLayout(show, type = "all") {
        if (!this.memory.rotation === undefined || !this.memory.centerPosition) {
            return "No layout defined";
        }
        if (!show) {
            for (let flagName in Game.flags) {
                let flag = Game.flags[flagName];
                if (flag.name.indexOf(`${this.name}_layout`) >= 0) {
                    flag.remove();
                }
            }
            return "removing layout flags";
        }
        for (let structureType of Object.keys(CONSTRUCTION_COST)) {
            if (type == "all" || type == structureType) {
                let coords = this.layoutCoords(structureType);
                let order = 0;
                for (let coord of coords) {
                    let flagName = `${this.name}_layout_${structureType}_${order++}`;
                    let flag = Game.flags[flagName];
                    if (flag) {
                        flag.setPosition(coord.x, coord.y);
                        continue;
                    }
                    let position = helper.coordToPosition(coord, this.memory.centerPosition, this.memory.rotation);
                    let color = COLOR_WHITE;
                    if (structureType === STRUCTURE_EXTENSION || structureType === STRUCTURE_SPAWN
                        || structureType === STRUCTURE_STORAGE || structureType === STRUCTURE_NUKER) {
                        color = COLOR_YELLOW;
                    }
                    else if (structureType === STRUCTURE_TOWER) {
                        color = COLOR_BLUE;
                    }
                    else if (structureType === STRUCTURE_LAB || structureType === STRUCTURE_TERMINAL) {
                        color = COLOR_CYAN;
                    }
                    else if (structureType === STRUCTURE_POWER_SPAWN) {
                        color = COLOR_RED;
                    }
                    else if (structureType === STRUCTURE_OBSERVER) {
                        color = COLOR_BROWN;
                    }
                    else if (structureType === STRUCTURE_ROAD) {
                        color = COLOR_GREY;
                    }
                    else if (structureType === STRUCTURE_RAMPART) {
                        color = COLOR_GREEN;
                    }
                    position.createFlag(flagName, color);
                }
            }
        }
        return `showing layout flags for: ${type}`;
    }
    autoLayout() {
        this.initWithSpawn();
        if (!this.memory.centerPosition || this.memory.rotation === undefined)
            return;
        this.initAutoLayout();
        this.buildLayout();
    }
    buildLayout() {
        if (!this.flag.room)
            return;
        let structureTypes = Object.keys(CONSTRUCTION_COST);
        if (this.memory.checkLayoutIndex === undefined || this.memory.checkLayoutIndex >= structureTypes.length) {
            this.memory.checkLayoutIndex = 0;
        }
        let structureType = structureTypes[this.memory.checkLayoutIndex++];
        this.fixedPlacement(structureType);
        this.temporaryPlacement(this.flag.room.controller.level);
    }
    fixedPlacement(structureType) {
        let controllerLevel = this.flag.room.controller.level;
        let constructionPriority = Math.max(controllerLevel * 10, 40);
        if (controllerLevel === 1) {
            constructionPriority = 90;
        }
        if (Object.keys(Game.constructionSites).length > constructionPriority)
            return;
        if (structureType === STRUCTURE_RAMPART && controllerLevel < 5)
            return;
        if (!this.memory.lastChecked)
            this.memory.lastChecked = {};
        if (Game.time - this.memory.lastChecked[structureType] < 1000)
            return;
        let coords = this.layoutCoords(structureType);
        let allowedCount = this.allowedCount(structureType, controllerLevel);
        for (let i = 0; i < coords.length; i++) {
            if (i >= allowedCount)
                break;
            let coord = coords[i];
            let position = helper.coordToPosition(coord, this.memory.centerPosition, this.memory.rotation);
            let structure = position.lookForStructure(structureType);
            if (structure) {
                this.repairLayout(structure);
                continue;
            }
            let hasConstruction = position.lookFor(LOOK_CONSTRUCTION_SITES)[0];
            if (hasConstruction)
                continue;
            let outcome = position.createConstructionSite(structureType);
            if (outcome === OK) {
                console.log(`LAYOUT: placing ${structureType} at ${position} (${this.name})`);
            }
            return;
        }
        this.memory.lastChecked[structureType] = Game.time;
    }
    recalculateLayout(layoutType) {
        if (!this.memory.seedData) {
            let sourceData = [];
            for (let source of this.flag.room.find(FIND_SOURCES)) {
                sourceData.push({ pos: source.pos, amount: 3000 });
            }
            this.memory.seedData = {
                sourceData: sourceData,
                seedScan: {},
                seedSelectData: undefined
            };
        }
        let analysis = new SeedAnalysis(this.flag.room, this.memory.seedData);
        let results = analysis.run(this.staticStructures, layoutType);
        if (results) {
            let centerPosition = new RoomPosition(results.origin.x, results.origin.y, this.flag.room.name);
            if (results.seedType === this.type) {
                console.log(`${this.name} found best seed of type ${results.seedType}, initiating auto-layout`);
                this.memory.centerPosition = centerPosition;
                this.memory.rotation = results.rotation;
            }
            else {
                console.log(`${this.name} found best seed of another type, replacing operation`);
                let flagName = `${results.seedType}_${this.name}`;
                Memory.flags[flagName] = { centerPosition: centerPosition, rotation: results.rotation };
                this.flag.pos.createFlag(flagName, COLOR_GREY);
                this.flag.remove();
            }
            this.memory.seedData = undefined; // clean-up memory
        }
        else {
            console.log(`${this.name} could not find a suitable auto-layout, consider using another spawn location or room`);
        }
    }
    allowedCount(structureType, level) {
        if (level < 5 && (structureType === STRUCTURE_RAMPART || structureType === STRUCTURE_WALL
            || structureType === STRUCTURE_ROAD)) {
            return 0;
        }
        return Math.min(CONTROLLER_STRUCTURES[structureType][level], this.layoutCoords(structureType).length);
    }
    layoutCoords(structureType) {
        if (this.staticStructures[structureType]) {
            return this.staticStructures[structureType];
        }
        else if (this.memory.layoutMap && this.memory.layoutMap[structureType]) {
            return this.memory.layoutMap[structureType];
        }
        else {
            return [];
        }
    }
    initWithSpawn() {
        if (!this.flag.room)
            return;
        if (!this.memory.centerPosition || this.memory.rotation === undefined) {
            let structureCount = this.flag.room.find(FIND_STRUCTURES).length;
            if (structureCount === 1) {
                this.recalculateLayout();
            }
            else if (structureCount > 1) {
                this.recalculateLayout(this.type);
            }
            return;
        }
    }
    towerRepair() {
        if (this.flag.room.hostiles.length > 0)
            return;
        let structureType = STRUCTURE_RAMPART;
        if (Game.time % 2 === 0) {
            structureType = STRUCTURE_ROAD;
        }
        let coords = this.layoutCoords(structureType);
        if (!this.memory.repairIndices) {
            this.memory.repairIndices = {};
        }
        if (this.memory.repairIndices[structureType] === undefined ||
            this.memory.repairIndices[structureType] >= coords.length) {
            this.memory.repairIndices[structureType] = 0;
        }
        let coord = coords[this.memory.repairIndices[structureType]++];
        //FIXME this check is for a room with a failed layout
        if (this.memory.centerPosition) {
            let position = helper.coordToPosition(coord, this.memory.centerPosition, this.memory.rotation);
            let structure = position.lookForStructure(structureType);
            if (structure) {
                this.repairLayout(structure);
            }
        }
    }
    // deprecated
    findRemoteSpawn(distanceLimit, levelRequirement = 8) {
        let remoteSpawn = _(empire.spawnGroups)
            .filter((s) => {
            return Game.map.getRoomLinearDistance(this.flag.pos.roomName, s.room.name) <= distanceLimit
                && s.room.controller.level >= levelRequirement
                && s.averageAvailability > .3
                && s.isAvailable;
        })
            .sortBy((s) => {
            return Game.map.getRoomLinearDistance(this.flag.pos.roomName, s.room.name);
        })
            .head();
        return remoteSpawn;
    }
    repairLayout(structure) {
        let repairsNeeded = Math.floor((structure.hitsMax - structure.hits) / 800);
        if (structure.structureType === STRUCTURE_RAMPART) {
            if (structure.hits >= 100000) {
                return;
            }
        }
        else {
            if (repairsNeeded === 0) {
                return;
            }
        }
        let towers = this.flag.room.findStructures(STRUCTURE_TOWER);
        for (let tower of towers) {
            if (repairsNeeded === 0) {
                return;
            }
            if (tower.alreadyFired) {
                continue;
            }
            if (!tower.pos.inRangeTo(structure, Math.max(5, this.memory.radius - 3))) {
                continue;
            }
            let outcome = tower.repair(structure);
            repairsNeeded--;
        }
        if (repairsNeeded > 0 && towers.length > 0) {
            structure.pos.findClosestByRange(towers).repair(structure);
        }
    }
    placeLink(source) {
        if (source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2).length > 0)
            return;
        if (source.pos.findInRange(source.room.findStructures(STRUCTURE_LINK), 2).length > 0)
            return;
        let positions = [];
        let ret = empire.traveler.findTravelPath(this.room.storage, source);
        if (ret.incomplete) {
            console.log(`LINKMINER: Path to source incomplete ${this.flag.pos.roomName}`);
        }
        let minerPos = _.last(ret.path);
        for (let position of minerPos.openAdjacentSpots(true)) {
            if (!position.isPassible(true)) {
                continue;
            }
            if (position.findInRange([this.room.controller], 3).length > 0) {
                continue;
            }
            if (position.findInRange(FIND_SOURCES, 2).length > 1) {
                continue;
            }
            if (position.findInRange(ret.path, 0).length > 0) {
                continue;
            }
            positions.push(position);
        }
        if (positions.length === 0) {
            console.log(`LINKMINER: no suitable position for link ${this.flag.pos.roomName}`);
        }
        positions = _.sortBy(positions, (p) => p.getRangeTo(this.flag.room.storage));
        positions[0].createConstructionSite(STRUCTURE_LINK);
        notifier.log(`placed link ${this.flag.room.name}`);
    }
}

const QUAD_RADIUS = 6;
class QuadOperation extends ControllerOperation {
    constructor() {
        /**
         * Manages the activities of an owned room, assumes bonzaiferroni's build spec
         * @param flag
         * @param name
         * @param type
         * @param empire
         */
        super(...arguments);
        this.staticStructures = {
            [STRUCTURE_SPAWN]: [{ x: 2, y: 0 }, { x: 0, y: -2 }, { x: -2, y: 0 }],
            [STRUCTURE_TOWER]: [
                { x: 1, y: -1 }, { x: -1, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }
            ],
            [STRUCTURE_EXTENSION]: [
                { x: 3, y: -1 }, { x: 2, y: -2 }, { x: 1, y: -3 }, { x: 3, y: -2 }, { x: 2, y: -3 },
                { x: 0, y: -4 }, { x: -1, y: -3 }, { x: -2, y: -2 }, { x: -3, y: -1 }, { x: -3, y: -2 },
                { x: -2, y: -3 }, { x: -2, y: -4 }, { x: 4, y: 0 }, { x: -4, y: 0 }, { x: -3, y: 1 },
                { x: -1, y: 1 }, { x: 3, y: 1 }, { x: 4, y: -2 }, { x: 3, y: -3 }, { x: 2, y: -4 },
                { x: -3, y: -3 }, { x: -4, y: -2 }, { x: 5, y: -3 }, { x: 4, y: -4 }, { x: 3, y: -5 },
                { x: -3, y: -5 }, { x: -4, y: -4 }, { x: -5, y: -3 }, { x: 3, y: 2 }, { x: 3, y: 3 },
                { x: 4, y: 2 }, { x: 3, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 1 },
                { x: 5, y: 0 }, { x: 5, y: -1 }, { x: 5, y: -4 }, { x: 5, y: -5 }, { x: 4, y: -5 },
                { x: 1, y: -5 }, { x: 0, y: -5 }, { x: -1, y: -5 }, { x: -4, y: -5 }, { x: -5, y: -5 },
                { x: -5, y: -4 }, { x: -5, y: -1 }, { x: -5, y: 0 }, { x: -5, y: 1 }, { x: 4, y: 5 },
                { x: 5, y: 4 }, { x: 5, y: 5 }, { x: -6, y: 2 }, { x: -6, y: -2 }, { x: -2, y: -6 },
                { x: 2, y: 4 }, { x: 2, y: -6 }, { x: 6, y: -2 }, { x: 6, y: 2 }, { x: 2, y: 3 },
            ],
            [STRUCTURE_STORAGE]: [{ x: 0, y: 4 }],
            [STRUCTURE_TERMINAL]: [{ x: -2, y: 2 }],
            [STRUCTURE_NUKER]: [{ x: 0, y: 6 }],
            [STRUCTURE_POWER_SPAWN]: [{ x: 0, y: 2 }],
            [STRUCTURE_OBSERVER]: [{ x: -5, y: 5 }],
            [STRUCTURE_LAB]: [
                { x: -2, y: 4 }, { x: -3, y: 3 }, { x: -4, y: 2 }, { x: -3, y: 5 }, { x: -4, y: 4 },
                { x: -5, y: 3 }, { x: -2, y: 3 }, { x: -3, y: 2 }, { x: -4, y: 5 }, { x: -5, y: 4 }
            ],
            [STRUCTURE_ROAD]: [
                // diamond (n = 12)
                { x: 3, y: 0 }, { x: 2, y: -1 }, { x: 1, y: -2 }, { x: 0, y: -3 }, { x: -1, y: -2 },
                { x: -2, y: -1 }, { x: -3, y: 0 }, { x: -2, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 3 },
                { x: 1, y: 2 }, { x: 2, y: 1 },
                // x-pattern (n = 24)
                { x: 4, y: -1 }, { x: 5, y: -2 }, { x: 4, y: -3 },
                { x: 3, y: -4 }, { x: 2, y: -5 }, { x: 1, y: -4 }, { x: -1, y: -4 }, { x: -2, y: -5 },
                { x: -3, y: -4 }, { x: -4, y: -3 }, { x: -5, y: -2 }, { x: -4, y: -1 }, { x: -4, y: 1 },
                { x: -5, y: 2 }, { x: -4, y: 3 }, { x: -3, y: 4 }, { x: -2, y: 5 }, { x: -1, y: 4 },
                { x: 1, y: 4 }, { x: 2, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 2 },
                { x: 4, y: 1 },
                // outside (n = 33)
                { x: 6, y: -3 }, { x: 6, y: -4 }, { x: 6, y: -5 }, { x: 5, y: -6 },
                { x: 4, y: -6 }, { x: 3, y: -6 }, { x: 1, y: -6 }, { x: 0, y: -6 }, { x: -1, y: -6 },
                { x: -3, y: -6 }, { x: -4, y: -6 }, { x: -5, y: -6 }, { x: -6, y: -5 }, { x: -6, y: -4 },
                { x: -6, y: -3 }, { x: -6, y: -1 }, { x: -6, y: 0 }, { x: -6, y: 1 }, { x: -6, y: 3 },
                { x: -6, y: 4 }, { x: -6, y: 5 }, { x: -5, y: 6 }, { x: -4, y: 6 }, { x: -3, y: 6 },
                { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 },
                { x: 6, y: 3 }, { x: 6, y: 1 }, { x: 6, y: 0 }, { x: 6, y: -1 },
            ],
            [STRUCTURE_RAMPART]: [
                // top wall (n = 12)
                { x: -5, y: -6 }, { x: -4, y: -6 }, { x: -3, y: -6 }, { x: -2, y: -6 }, { x: -1, y: -6 },
                { x: 0, y: -6 }, { x: 1, y: -6 }, { x: 2, y: -6 }, { x: 3, y: -6 }, { x: 4, y: -6 },
                { x: 5, y: -6 }, { x: 5, y: -5 },
                // right wall (n = 12)
                { x: 6, y: -5 }, { x: 6, y: -4 }, { x: 6, y: -3 }, { x: 6, y: -2 }, { x: 6, y: -1 },
                { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 },
                { x: 6, y: 5 }, { x: 5, y: 5 },
                // bottom wall (n = 12)
                { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }, { x: 2, y: 6 }, { x: 1, y: 6 },
                { x: 0, y: 6 }, { x: -1, y: 6 }, { x: -2, y: 6 }, { x: -3, y: 6 }, { x: -4, y: 6 },
                { x: -5, y: 6 }, { x: -5, y: 5 },
                // left wall (n = 12)
                { x: -6, y: 5 }, { x: -6, y: 4 }, { x: -6, y: 3 }, { x: -6, y: 2 }, { x: -6, y: 1 },
                { x: -6, y: 0 }, { x: -6, y: -1 }, { x: -6, y: -2 }, { x: -6, y: -3 }, { x: -6, y: -4 },
                { x: -6, y: -5 }, { x: -5, y: -5 },
                // storage (n = 1)
                { x: 0, y: 4 },
                // labs (n = 8)
                { x: -4, y: 5 }, { x: -5, y: 4 }, { x: -5, y: 3 }, { x: -4, y: 4 }, { x: -3, y: 5 },
                { x: -4, y: 2 }, { x: -3, y: 3 }, { x: -2, y: 4 },
            ]
        };
    }
    initAutoLayout() {
        if (!this.memory.layoutMap) {
            this.memory.layoutMap = {};
            this.memory.radius = QUAD_RADIUS;
        }
    }
    temporaryPlacement(level) {
        if (!this.memory.temporaryPlacement)
            this.memory.temporaryPlacement = {};
        if (!this.memory.temporaryPlacement[level]) {
            let actions = [];
            // links
            if (level === 5) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 2, y: 2 } });
            }
            if (level === 6) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 2, y: 3 } });
            }
            if (level === 7) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 2, y: 4 } });
            }
            if (level === 8) {
                actions.push({ actionType: "remove", structureType: STRUCTURE_LINK, coord: { x: 2, y: 3 } });
                actions.push({ actionType: "remove", structureType: STRUCTURE_LINK, coord: { x: 2, y: 4 } });
            }
            for (let action of actions) {
                let outcome;
                let position = helper.coordToPosition(action.coord, this.memory.centerPosition, this.memory.rotation);
                if (action.actionType === "place") {
                    outcome = position.createConstructionSite(action.structureType);
                }
                else {
                    let structure = position.lookForStructure(action.structureType);
                    if (structure) {
                        outcome = structure.destroy();
                    }
                    else {
                        outcome = "noStructure";
                    }
                }
                if (outcome === OK) {
                    console.log(`LAYOUT: ${action.actionType}d temporary ${action.structureType} (${this.name}, level: ${level})`);
                }
                else {
                    console.log(`LAYOUT: problem with temp placement, please follow up in ${this.name}`);
                    console.log(`tried to ${action.actionType} ${action.structureType} at level ${level}, outcome: ${outcome}`);
                }
            }
            this.memory.temporaryPlacement[level] = true;
        }
    }
}

class FlexGenerator {
    constructor(centerPosition, rotation, staticStructures) {
        this.leftMost = 0;
        this.rightMost = 0;
        this.topMost = 0;
        this.bottomMost = 0;
        this.radius = 0;
        this.remaining = {
            [STRUCTURE_TOWER]: 6,
            [STRUCTURE_EXTENSION]: 60,
            [STRUCTURE_OBSERVER]: 1,
        };
        this.map = {};
        this.roadPositions = [];
        this.noRoadAccess = [];
        this.recheckCount = 0;
        if (!(centerPosition instanceof RoomPosition)) {
            centerPosition = helper.deserializeRoomPosition(centerPosition);
        }
        this.centerPosition = centerPosition;
        this.roomName = centerPosition.roomName;
        this.rotation = rotation;
        this.leftMost = centerPosition.x;
        this.rightMost = centerPosition.x;
        this.topMost = centerPosition.y;
        this.bottomMost = centerPosition.y;
        this.coreStructureCoordinates = staticStructures;
    }
    generate() {
        this.addFixedStructuresToMap();
        this.addUsingExpandingRadius();
        this.addWalls();
        this.removeStragglingRoads();
        return this.generateCoords();
    }
    addFixedStructuresToMap() {
        this.coreStructureCoordinates[STRUCTURE_ROAD] = [
            { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: -1, y: -1 }, { x: -2, y: -2 },
            { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 0, y: -4 }, { x: 1, y: -3 }, { x: 2, y: -2 },
            { x: 3, y: -1 }, { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 4 },
            { x: -1, y: 3 }, { x: -3, y: 1 }, { x: -4, y: 0 }, { x: -3, y: -1 }, { x: -1, y: -3 },
        ];
        this.coreStructureCoordinates["empty"] = [
            { x: -1, y: -2 }, { x: 1, y: -2 }, { x: 2, y: -1 }
        ];
        for (let structureType in this.coreStructureCoordinates) {
            let coords = this.coreStructureCoordinates[structureType];
            for (let coord of coords) {
                let position = helper.coordToPosition(coord, this.centerPosition, this.rotation);
                this.addStructurePosition(position, structureType);
            }
        }
    }
    addUsingExpandingRadius() {
        let iterations = 0;
        while (_.sum(this.remaining) > 0 && iterations < 100) {
            iterations++;
            for (let xDelta = -this.radius; xDelta <= this.radius; xDelta++) {
                let x = this.centerPosition.x + xDelta;
                if (x < 3 || x > 46) {
                    continue;
                }
                for (let yDelta = -this.radius; yDelta <= this.radius; yDelta++) {
                    // only consider points on perimeter of gradually expanding rectangle
                    if (Math.abs(yDelta) !== this.radius && Math.abs(xDelta) !== this.radius)
                        continue;
                    let y = this.centerPosition.y + yDelta;
                    if (y < 3 || y > 46) {
                        continue;
                    }
                    let position = new RoomPosition(x, y, this.roomName);
                    if (position.lookFor(LOOK_TERRAIN)[0] === "wall")
                        continue;
                    this.addRemaining(xDelta, yDelta);
                }
            }
            this.radius++;
        }
        if (iterations === 100) {
            console.log("WARNING: layout process entered endless loop, life is terrible, give up all hope");
        }
    }
    addRemaining(xDelta, yDelta, save = true) {
        let x = this.centerPosition.x + xDelta;
        let y = this.centerPosition.y + yDelta;
        let alreadyUsed = this.checkIfUsed(x, y);
        console.log(`alreadyUsed: ${alreadyUsed} x: ${xDelta}, y: ${yDelta}`);
        if (alreadyUsed)
            return;
        let position = new RoomPosition(x, y, this.roomName);
        if (Game.rooms[this.roomName]) {
            if (position.inRangeTo(position.findClosestByRange(FIND_SOURCES), 2))
                return;
            if (position.inRangeTo(Game.rooms[this.roomName].controller, 3))
                return;
        }
        let foundRoad = false;
        for (let roadPos of this.roadPositions) {
            if (position.isNearTo(roadPos)) {
                let structureType = this.findStructureType(xDelta, yDelta);
                console.log("findStructureType: " + structureType);
                if (structureType) {
                    this.addStructurePosition(position, structureType);
                    this.remaining[structureType]--;
                    foundRoad = true;
                    break;
                }
            }
        }
        if (!foundRoad && save) {
            this.noRoadAccess.push({ x: xDelta, y: yDelta });
        }
    }
    recheckNonAccess() {
        // if (this.recheckCount > 100) return;
        this.recheckCount++;
        if (this.recheckCount > 100)
            throw "too fucking long";
        console.log("rechecking " + this.recheckCount, this.noRoadAccess.length);
        this.noRoadAccess = _.filter(this.noRoadAccess, (c) => !this.checkIfUsed(c.x, c.y));
        for (let coord of this.noRoadAccess) {
            this.addRemaining(coord.x, coord.y, false);
        }
    }
    checkIfUsed(x, y) {
        return this.map[x] !== undefined && this.map[x][y] !== undefined;
    }
    addStructurePosition(pos, structureType, overwrite = false) {
        if (!this.map[pos.x])
            this.map[pos.x] = {};
        let existingStructureType = this.map[pos.x][pos.y];
        if (existingStructureType) {
            if (overwrite) {
                this.remaining[existingStructureType]++;
            }
            else {
                return;
            }
        }
        this.map[pos.x][pos.y] = structureType;
        if (structureType === STRUCTURE_ROAD) {
            console.log("foundRoad, add pos and recheck: " + pos);
            this.roadPositions.push(pos);
            this.recheckNonAccess();
        }
        else if (structureType !== STRUCTURE_RAMPART && structureType !== STRUCTURE_WALL) {
            if (pos.x < this.leftMost) {
                this.leftMost = pos.x;
            }
            if (pos.x > this.rightMost) {
                this.rightMost = pos.x;
            }
            if (pos.y < this.topMost) {
                this.topMost = pos.y;
            }
            if (pos.y > this.bottomMost) {
                this.bottomMost = pos.y;
            }
        }
    }
    findStructureType(xDelta, yDelta) {
        let isRoadCoord = this.checkValidRoadCoord(xDelta, yDelta);
        if (isRoadCoord) {
            return STRUCTURE_ROAD;
        }
        else {
            for (let structureType in this.remaining) {
                if (this.remaining[structureType]) {
                    return structureType;
                }
            }
        }
    }
    addWalls() {
        // push edge by 1 to make room for walls
        let leftWall = this.leftMost - 1;
        let rightWall = this.rightMost + 1;
        let topWall = this.topMost - 1;
        let bottomWall = this.bottomMost + 1;
        let allWallPositions = [];
        let validWallPositions = [];
        console.log(leftWall, rightWall, topWall, bottomWall);
        // mark off matrix, natural walls are impassible, all other tiles get 1
        let exitPositions = [];
        let matrix = new PathFinder.CostMatrix();
        let lastPositionWasExit = { left: false, right: false, top: false, bottom: false };
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                let currentBorder;
                if (x === 0)
                    currentBorder = "left";
                else if (x === 49)
                    currentBorder = "right";
                else if (y === 0)
                    currentBorder = "top";
                else if (y === 49)
                    currentBorder = "bottom";
                let position = new RoomPosition(x, y, this.roomName);
                if (position.lookFor(LOOK_TERRAIN)[0] === "wall") {
                    matrix.set(x, y, 0xff);
                    if (currentBorder) {
                        lastPositionWasExit[currentBorder] = false;
                    }
                }
                else {
                    matrix.set(x, y, 1);
                    if (currentBorder) {
                        if (!lastPositionWasExit[currentBorder]) {
                            exitPositions.push(position);
                        }
                        lastPositionWasExit[currentBorder] = true;
                    }
                }
            }
        }
        console.log(`LAYOUT: found ${exitPositions.length} exits to path from`);
        // start with every wall position being valid around the border
        for (let x = leftWall; x <= rightWall; x++) {
            for (let y = topWall; y <= bottomWall; y++) {
                if (x !== leftWall && x !== rightWall && y !== topWall && y !== bottomWall)
                    continue;
                let position = new RoomPosition(x, y, this.roomName);
                if (position.lookFor(LOOK_TERRAIN)[0] === "wall")
                    continue;
                allWallPositions.push(position);
                matrix.set(x, y, 0xff);
            }
        }
        // send theoretical invaders at the center from each exit and remove the walls that don't make a
        // difference on whether they reach the center
        let centerPosition = new RoomPosition(this.centerPosition.x, this.centerPosition.y, this.roomName);
        for (let wallPosition of allWallPositions) {
            let breach = false;
            matrix.set(wallPosition.x, wallPosition.y, 1);
            for (let exitPosition of exitPositions) {
                let ret = PathFinder.search(exitPosition, [{ pos: centerPosition, range: 0 }], {
                    maxRooms: 1,
                    roomCallback: (roomName) => {
                        if (roomName === this.roomName) {
                            return matrix;
                        }
                    }
                });
                if (!ret.incomplete && ret.path[ret.path.length - 1].inRangeTo(centerPosition, 0)) {
                    breach = true;
                    break;
                }
            }
            if (breach) {
                validWallPositions.push(wallPosition);
                matrix.set(wallPosition.x, wallPosition.y, 0xff);
            }
        }
        for (let position of validWallPositions) {
            this.addStructurePosition(position, STRUCTURE_RAMPART, true);
        }
        this.wallCount = validWallPositions.length;
    }
    generateCoords() {
        let roomPositions = {};
        for (let x in this.map) {
            for (let y in this.map[x]) {
                let structureType = this.map[x][y];
                if (structureType !== STRUCTURE_ROAD && _.includes(Object.keys(this.coreStructureCoordinates), structureType))
                    continue;
                if (!roomPositions[structureType])
                    roomPositions[structureType] = [];
                roomPositions[structureType].push(new RoomPosition(Number.parseInt(x), Number.parseInt(y), this.roomName));
            }
        }
        let flexLayoutMap = {};
        let centerPosition = new RoomPosition(this.centerPosition.x, this.centerPosition.y, this.roomName);
        for (let structureType in roomPositions) {
            let sortedByDistance = _.sortBy(roomPositions[structureType], (pos) => pos.getRangeTo(centerPosition));
            flexLayoutMap[structureType] = [];
            for (let position of sortedByDistance) {
                let coord = helper.positionToCoord(position, this.centerPosition, this.rotation);
                flexLayoutMap[structureType].push(coord);
            }
        }
        return flexLayoutMap;
    }
    checkValidRoadCoord(xDelta, yDelta) {
        // creates the 5-cluster pattern for extensions/roads that you can see in my rooms
        let combinedDeviance = Math.abs(xDelta) + Math.abs(yDelta);
        if (combinedDeviance % 2 !== 0) {
            return false;
        }
        else if (xDelta % 2 === 0 && combinedDeviance % 4 !== 0) {
            let pos = helper.coordToPosition({ x: xDelta, y: yDelta }, this.centerPosition);
            // check narrow passage due to natural walls
            for (let direction = 2; direction <= 8; direction += 2) {
                if (pos.getPositionAtDirection(direction).lookFor(LOOK_TERRAIN)[0] === "wall") {
                    return true;
                }
            }
            return false;
        }
        else {
            return true;
        }
    }
    removeStragglingRoads() {
        for (let x in this.map) {
            for (let y in this.map[x]) {
                let xInt = Number.parseInt(x);
                let yInt = Number.parseInt(y);
                if (xInt < this.leftMost - 1 || xInt > this.rightMost + 1
                    || yInt < this.topMost - 1 || yInt > this.bottomMost + 1) {
                    this.map[x][y] = undefined;
                }
            }
        }
    }
}

class FlexOperation extends ControllerOperation {
    constructor() {
        super(...arguments);
        this.staticStructures = {
            [STRUCTURE_STORAGE]: [{ x: 0, y: -3 }],
            [STRUCTURE_TERMINAL]: [{ x: -2, y: -1 }],
            [STRUCTURE_SPAWN]: [{ x: -2, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 3 }],
            [STRUCTURE_NUKER]: [{ x: 3, y: 0 }],
            [STRUCTURE_POWER_SPAWN]: [{ x: -3, y: 0 }],
            [STRUCTURE_LAB]: [
                { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 },
                { x: 1, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 },
                { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: -1 }, { x: -1, y: 1 },
            ],
        };
    }
    temporaryPlacement(level) {
        if (!this.memory.temporaryPlacement)
            this.memory.temporaryPlacement = {};
        if (!this.memory.temporaryPlacement[level]) {
            let actions = [];
            // links
            if (level === 5) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 2, y: -1 } });
            }
            if (level === 6) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 1, y: -1 } });
            }
            if (level === 7) {
                actions.push({ actionType: "place", structureType: STRUCTURE_LINK, coord: { x: 0, y: -1 } });
            }
            if (level === 8) {
                actions.push({ actionType: "remove", structureType: STRUCTURE_LINK, coord: { x: 1, y: -1 } });
                actions.push({ actionType: "remove", structureType: STRUCTURE_LINK, coord: { x: 0, y: -1 } });
            }
            for (let action of actions) {
                let outcome;
                let position = helper.coordToPosition(action.coord, this.memory.centerPosition, this.memory.rotation);
                if (action.actionType === "place") {
                    outcome = position.createConstructionSite(action.structureType);
                }
                else {
                    let structure = position.lookForStructure(action.structureType);
                    if (structure) {
                        outcome = structure.destroy();
                    }
                    else {
                        outcome = "noStructure";
                    }
                }
                if (outcome === OK) {
                    console.log(`LAYOUT: ${action.actionType}d temporary ${action.structureType} (${this.name}, level: ${level})`);
                }
                else {
                    console.log(`LAYOUT: problem with temp placement, please follow up in ${this.name}`);
                    console.log(`tried to ${action.actionType} ${action.structureType} at level ${level}, outcome: ${outcome}`);
                }
            }
            this.memory.temporaryPlacement[level] = true;
        }
    }
    initAutoLayout() {
        if (!this.memory.layoutMap) {
            if (this.memory.flexLayoutMap) {
                // temporary patch for variable identifier change
                this.memory.layoutMap = this.memory.flexLayoutMap;
                this.memory.radius = this.memory.flexRadius;
            }
            else {
                let map = new FlexGenerator(this.memory.centerPosition, this.memory.rotation, this.staticStructures);
                this.memory.layoutMap = map.generate();
                this.memory.radius = map.radius + 1;
            }
        }
    }
}

var consoleCommands = {
    /**
     * Remove construction sites from a missionRoom
     * @param roomName
     * @param leaveProgressStarted - leave sites already started
     * @param structureType
     */
    removeConstructionSites(roomName, leaveProgressStarted = true, structureType) {
        Game.rooms[roomName].find(FIND_MY_CONSTRUCTION_SITES).forEach((site) => {
            if ((!structureType || site.structureType === structureType) && (!leaveProgressStarted || site.progress === 0)) {
                site.remove();
            }
        });
    },
    // shorthand
    rc(roomName, leaveProgressStarted, structureType) {
        this.removeConstructionSites(roomName, leaveProgressStarted, structureType);
    },
    /**
     * Remove all flags that contain a substring in the name, good for wiping out a previously used operation
     * @param substr
     */
    removeFlags(substr) {
        _.forEach(Game.flags, (flag) => {
            if (_.includes(flag.name, substr)) {
                console.log(`removing flag ${flag.name} in ${flag.pos.roomName}`);
                flag.remove();
            }
        });
    },
    // shorthand
    rf(substr) {
        this.removeFlags(substr);
    },
    /**
     * remove most memory while leaving more important stuff intact, strongly not recommended unless you know what you are
     * doing
     */
    wipeMemory() {
        for (let flagName in Memory.flags) {
            let flag = Game.flags[flagName];
            if (flag) {
                for (let propertyName of Object.keys(flag.memory)) {
                    if (propertyName === "power")
                        continue;
                    if (propertyName === "centerPosition")
                        continue;
                    if (propertyName === "rotation")
                        continue;
                    if (propertyName === "radius")
                        continue;
                    if (propertyName === "layoutMap")
                        continue;
                    delete flag.memory[propertyName];
                }
            }
            else {
                delete Memory.flags[flagName];
            }
        }
        for (let creepName in Memory.creeps) {
            let creep = Game.creeps[creepName];
            if (!creep) {
                delete Memory.creeps[creepName];
            }
        }
    },
    /**
     * remove old properties in memory that are no longer being used by the AI
     */
    removeUnusedProperties() {
        let hostiles = false;
        if (Memory.empire["hostileRooms"]) {
            hostiles = true;
            delete Memory.empire["hostileRooms"];
        }
        let radarCount = 0;
        let spawnCount = 0;
        let analCount = 0;
        let flagCount = 0;
        for (let flagName in Memory.flags) {
            let flag = Game.flags[flagName];
            if (flag) {
                let flagMemory = Memory.flags[flagName];
                for (let missionName in flagMemory) {
                    if (!flagMemory.hasOwnProperty(missionName)) {
                        continue;
                    }
                    let missionMemory = flagMemory[missionName];
                    if (missionName === "radar") {
                        radarCount++;
                        delete flagMemory[missionName];
                    }
                    if (missionMemory["spawn"]) {
                        spawnCount++;
                        delete missionMemory["spawn"];
                    }
                    if (missionMemory["anal"]) { // :)
                        analCount++;
                        delete missionMemory["anal"];
                    }
                    if (missionName === "bodyguard" || missionName === "defense") {
                        delete missionMemory["invaderProbable"];
                        delete missionMemory["invaderTrack"];
                    }
                }
            }
            else {
                flagCount++;
                delete Memory.flags[flagName];
            }
        }
        let creepCount = 0;
        for (let creepName in Memory.creeps) {
            let creep = Game.creeps[creepName];
            if (!creep) {
                creepCount++;
                delete Memory.creeps[creepName];
            }
        }
        return `gc Creeps: ${creepCount}, gc flags: ${flagCount}, spawn: ${spawnCount}, radar: ${radarCount}\n` +
            `analysis: ${analCount}, hostileRooms: ${hostiles}`;
    },
    removeMissionData(missionName) {
        for (let flagName in Memory.flags) {
            delete Memory.flags[flagName][missionName];
        }
    },
    /**
     * Empty resources from a terminal, will only try to send one resource each tick so this must be called repeatedly
     * on multiple ticks with the same arguments to completely empty a terminal
     * @param origin
     * @param destination
     * @returns {any}
     */
    emptyTerminal(origin, destination) {
        let originTerminal = Game.rooms[origin].terminal;
        let outcome;
        for (let resourceType in originTerminal.store) {
            if (!originTerminal.store.hasOwnProperty(resourceType))
                continue;
            let amount = originTerminal.store[resourceType];
            if (amount >= 100) {
                if (resourceType !== RESOURCE_ENERGY) {
                    outcome = originTerminal.send(resourceType, amount, destination);
                    break;
                }
                else if (Object.keys(originTerminal.store).length === 1) {
                    let distance = Game.map.getRoomLinearDistance(origin, destination, true);
                    let stored = originTerminal.store.energy;
                    let amountSendable = Math.floor(stored / (1 + 0.1 * distance));
                    console.log("sending", amountSendable, "out of", stored);
                    outcome = originTerminal.send(RESOURCE_ENERGY, amountSendable, destination);
                }
            }
        }
        return outcome;
    },
    /**
     * Changes the name of an operation, giving it a new flag. May result in some unintended consequences
     * @param opName
     * @param newOpName
     * @returns {any}
     */
    changeOpName(opName, newOpName) {
        let operation = Game.operations[opName];
        if (!operation)
            return "you don't have an operation by that name";
        let newFlagName = operation.type + "_" + newOpName;
        let outcome = operation.flag.pos.createFlag(newFlagName, operation.flag.color, operation.flag.secondaryColor);
        if (_.isString(outcome)) {
            Memory.flags[newFlagName] = operation.memory;
            operation.flag.remove();
            return `success, changed ${opName} to ${newOpName} (removing old flag)`;
        }
        else {
            return "error changing name: " + outcome;
        }
    },
    /**
     * Place an order for a resource to be sent to any missionRoom. Good for making one-time deals.
     * @param resourceType
     * @param amount
     * @param roomName
     * @param efficiency - the number of terminals that should send the resource per tick, use a lower number to only send
     * from the nearest terminals
     * @returns {any}
     */
    order(resourceType, amount, roomName, efficiency = 10) {
        if (!(amount > 0)) {
            return "usage: order(resourceType, amount, roomName, efficiency?)";
        }
        if (Game.map.getRoomLinearDistance("E0S0", roomName) < 0) {
            return "usage: order(resourceType, amount, roomName, efficiency?)";
        }
        if (efficiency <= 0) {
            return "efficiency must be >= 1";
        }
        Memory.resourceOrder[Game.time] = { resourceType: resourceType, amount: amount, roomName: roomName,
            efficiency: efficiency, amountSent: 0 };
        return "TRADE: scheduling " + amount + " " + resourceType + " to be sent to " + roomName;
    },
    /**
     * One-time send resource from all terminals to a specific missionRoom. For more control use cc.order()
     * @param resourceType
     * @param amount
     * @param roomName
     */
    sendFromAll(resourceType, amount, roomName) {
        _.forEach(Game.rooms, (room) => {
            if (room.controller && room.controller.level > 6 && room.terminal && room.terminal.my) {
                let outcome = room.terminal.send(resourceType, amount, roomName);
                console.log(room.name, " sent ", amount, " to ", roomName);
            }
        });
    },
    patchTraderMemory() {
        for (let username in Memory.traders) {
            let data = Memory.traders[username];
            if (data.recieved) {
                for (let resourceType in data.recieved) {
                    let amount = data.recieved[resourceType];
                    if (data[resourceType] === undefined)
                        data[resourceType] = 0;
                    data[resourceType] += amount;
                }
            }
            if (data.sent) {
                for (let resourceType in data.sent) {
                    let amount = data.sent[resourceType];
                    if (data[resourceType] === undefined)
                        data[resourceType] = 0;
                    data[resourceType] -= amount;
                }
            }
            delete data.recieved;
            delete data.sent;
        }
    },
    /**
     * If this looks silly it is because it is, I used to it go from one naming convention to another
     * @param opName
     * @returns {any}
     */
    roomConvention(opName, alternate) {
        let controllerOp = Game.operations[opName + 0];
        if (!controllerOp) {
            return "owned missionRoom doesn't exist";
        }
        for (let direction = 1; direction <= 8; direction++) {
            let tempName = opName + "temp" + direction;
            if (!Game.operations[tempName])
                continue;
            console.log(`found temp ${tempName}`);
            let desiredName = opName + direction;
            let currentOp = Game.operations[desiredName];
            if (currentOp) {
                console.log(`current op with that name, changing name to temp`);
                let tempDir = WorldMap.findRelativeRoomDir(controllerOp.flag.room.name, currentOp.flag.room.name);
                return this.changeOpName(desiredName, opName + "temp" + tempDir);
            }
            console.log(`no temp conflicts`);
            return this.changeOpName(tempName, desiredName);
        }
        for (let direction = 1; direction <= 9; direction++) {
            let testOpName = opName + direction;
            let testOp = Game.operations[testOpName];
            if (!testOp && alternate) {
                testOp = Game.operations[alternate + direction];
                if (testOp) {
                    testOpName = alternate + direction;
                }
            }
            if (!testOp) {
                continue;
            }
            let correctDir = WorldMap.findRelativeRoomDir(controllerOp.flag.room.name, testOp.flag.room.name);
            if (correctDir === direction) {
                continue;
            }
            let correctOpName = opName + correctDir;
            console.log(`inconsistent name (${testOpName} at dir ${correctDir} should be ${correctOpName})`);
            let currentOp = Game.operations[correctOpName];
            if (currentOp) {
                console.log(`current op with that name, changing name to temp`);
                let tempDir = WorldMap.findRelativeRoomDir(controllerOp.flag.room.name, currentOp.flag.room.name);
                return this.changeOpName(correctOpName, opName + "temp" + tempDir);
            }
            else {
                console.log(`no current op with that name`);
                return this.changeOpName(testOpName, correctOpName);
            }
        }
        return `all flags consistent`;
    },
    test(from, to) {
        let fromPos = helper.pathablePosition(from);
        let toPos = helper.pathablePosition(to);
        let consideredRooms = {};
        let firstCPU = Game.cpu.getUsed();
        let ret = PathFinder.search(fromPos, toPos, {
            maxOps: 20000,
            roomCallback: (roomName) => consideredRooms[roomName] = true
        });
        firstCPU = Game.cpu.getUsed() - firstCPU;
        let consideredRooms2 = {};
        let secondCPU = Game.cpu.getUsed();
        let range = Game.map.getRoomLinearDistance(from, to);
        let ret2 = PathFinder.search(fromPos, toPos, {
            maxOps: 20000,
            roomCallback: (roomName) => {
                if (Game.map.getRoomLinearDistance(roomName, to) > range) {
                    return false;
                }
                consideredRooms2[roomName] = true;
            }
        });
        secondCPU = Game.cpu.getUsed() - secondCPU;
        return `First path:\n` +
            `considered ${Object.keys(consideredRooms)}\n` +
            `searched ${Object.keys(consideredRooms).length} rooms\n` +
            `opsUsed ${ret.ops}\n` +
            `incomplete ${ret.incomplete}\n` +
            `path length ${ret.path.length}\n` +
            `cpu: ${firstCPU}` + `Second path:\n` +
            `considered ${Object.keys(consideredRooms2)}\n` +
            `searched ${Object.keys(consideredRooms2).length} rooms\n` +
            `opsUsed ${ret2.ops}\n` +
            `incomplete ${ret2.incomplete}\n` +
            `path length ${ret2.path.length}\n` +
            `cpu: ${secondCPU}`;
    },
    testCPU() {
        let iterations = 1000;
        let cpu = Game.cpu.getUsed();
        let baseline = Game.cpu.getUsed() - cpu;
        cpu = Game.cpu.getUsed();
        for (let i = 0; i < iterations; i++) {
            Game.map.getRoomLinearDistance("W25S25", "E25S25");
        }
        return `cpu: ${Game.cpu.getUsed() - cpu - baseline} ${Game.cpu.getUsed() - cpu} ${baseline}`;
    },
    resetPathCPU() {
        let count = 0;
        for (let creepName in Game.creeps) {
            let creep = Game.creeps[creepName];
            if (creep.memory._travel) {
                count++;
                creep.memory._travel.cpu = 0;
            }
        }
        return `reset cpu for ${count} creeps`;
    },
};

const OPERATION_CLASSES = {
    flex: FlexOperation,
    quad: QuadOperation,
};
var empire;
var loopHelper = {
    initEmpire: function () {
        empire = new Empire();
        global.emp = empire;
        empire.init();
    },
    getOperations: function (empire) {
        // gather flag data, instantiate operations
        let operationList = {};
        for (let flagName in Game.flags) {
            for (let typeName in OPERATION_CLASSES) {
                if (!OPERATION_CLASSES.hasOwnProperty(typeName))
                    continue;
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
        return _.sortBy(operationList, (operation) => operation.priority);
    },
    initMemory: function () {
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
    scavangeResources: function () {
        for (let v in Game.rooms) {
            let room = Game.rooms[v];
            let resources = room.find(FIND_DROPPED_RESOURCES);
            for (let resource of resources) {
                if (resource.amount > 10) {
                    let creep = resource.pos.lookFor(LOOK_CREEPS)[0];
                    if (creep && creep.my && creep.memory.scavanger === resource.resourceType
                        && (!creep.carry[resource.resourceType] || creep.carry[resource.resourceType] < creep.carryCapacity)) {
                        let outcome = creep.pickup(resource);
                    }
                }
            }
        }
    },
    invalidateCache: Game.time % CACHE_INVALIDATION_FREQUENCY < CACHE_INVALIDATION_PERIOD,
    initConsoleCommands: function () {
        // command functions found in consoleCommands.ts can be executed from the game console
        // example: cc.minv()
        global.cc = consoleCommands;
        global.note = notifier;
        global.helper = helper;
    },
    garbageCollection: function () {
        if (Game.time < Memory.nextGC) {
            return;
        }
        for (let id in Memory.hostileMemory) {
            let creep = Game.getObjectById(id);
            if (!creep) {
                delete Memory.hostileMemory[id];
            }
        }
        Memory.nextGC = Game.time += helper.randomInterval(100);
    }
};

function initRoomPrototype() {
    Object.defineProperty(Room.prototype, "hostiles", {
        get: function myProperty() {
            if (!Game.cache.hostiles[this.name]) {
                let hostiles = this.find(FIND_HOSTILE_CREEPS);
                let filteredHostiles = [];
                for (let hostile of hostiles) {
                    let username = hostile.owner.username;
                    let isEnemy = empire.diplomat.checkEnemy(username, this.name);
                    if (isEnemy) {
                        filteredHostiles.push(hostile);
                    }
                }
                Game.cache.hostiles[this.name] = filteredHostiles;
            }
            return Game.cache.hostiles[this.name];
        }
    });
    // deprecated
    Object.defineProperty(Room.prototype, "hostilesAndLairs", {
        get: function myProperty() {
            if (!Game.cache.hostilesAndLairs[this.name]) {
                let lairs = _.filter(this.findStructures(STRUCTURE_KEEPER_LAIR), (lair) => {
                    return !lair.ticksToSpawn || lair.ticksToSpawn < 10;
                });
                Game.cache.hostilesAndLairs[this.name] = lairs.concat(this.hostiles);
            }
            return Game.cache.hostilesAndLairs[this.name];
        }
    });
    Object.defineProperty(Room.prototype, "roomType", {
        get: function myProperty() {
            if (!this.memory.roomType) {
                // source keeper
                let lairs = this.findStructures(STRUCTURE_KEEPER_LAIR);
                if (lairs.length > 0) {
                    this.memory.roomType = ROOMTYPE_SOURCEKEEPER;
                }
                // core
                if (!this.memory.roomType) {
                    let sources = this.find(FIND_SOURCES);
                    if (sources.length === 3) {
                        this.memory.roomType = ROOMTYPE_CORE;
                    }
                }
                // controller rooms
                if (!this.memory.roomType) {
                    if (this.controller) {
                        this.memory.roomType = ROOMTYPE_CONTROLLER;
                    }
                    else {
                        this.memory.roomType = ROOMTYPE_ALLEY;
                    }
                }
            }
            return this.memory.roomType;
        }
    });
    Object.defineProperty(Room.prototype, "structures", {
        get: function myProperty() {
            if (!Game.cache.structures[this.name]) {
                Game.cache.structures[this.name] = _.groupBy(this.find(FIND_STRUCTURES), (s) => s.structureType);
            }
            return Game.cache.structures[this.name] || [];
        }
    });
    /**
     * Returns array of structures, caching results on a per-tick basis
     * @param structureType
     * @returns {Structure[]}
     */
    Room.prototype.findStructures = function (structureType) {
        if (!Game.cache.structures[this.name]) {
            Game.cache.structures[this.name] = _.groupBy(this.find(FIND_STRUCTURES), (s) => s.structureType);
        }
        return Game.cache.structures[this.name][structureType] || [];
    };
    /**
     * Finds creeps and containers in missionRoom that will give up energy, primarily useful when a storage is not available
     * Caches results on a per-tick basis. Useful before storage is available or in remote mining rooms.
     * @param roomObject - When this optional argument is supplied, return closest source
     * @returns {StructureContainer|Creep} - Returns source with highest amount of available energy, unless roomObject is
     * supplied
     */
    Room.prototype.getAltBattery = function (roomObject) {
        if (!this.altBatteries) {
            let possibilities = [];
            let containers = this.findStructures(STRUCTURE_CONTAINER);
            if (this.controller && this.controller.getBattery() instanceof StructureContainer) {
                _.pull(containers, this.controller.getBattery());
            }
            for (let container of containers) {
                if (container.store.energy >= 50) {
                    possibilities.push(container);
                }
            }
            let creeps = this.find(FIND_MY_CREEPS, { filter: (c) => c.memory.donatesEnergy });
            for (let creep of creeps) {
                if (creep.carry.energy >= 50) {
                    possibilities.push(creep);
                }
            }
            if (this.terminal && this.terminal.store.energy >= 50) {
                possibilities.push(this.terminal);
            }
            this.altBatteries = _.sortBy(possibilities, (p) => {
                return Agent.normalizeStore((p)).store.energy;
            });
        }
        if (roomObject) {
            return roomObject.pos.findClosestByRange(this.altBatteries);
        }
        else {
            return _.last(this.altBatteries);
        }
    };
    /**
     * Returns missionRoom coordinates for a given missionRoom
     * @returns {*}
     */
    Object.defineProperty(Room.prototype, "coords", {
        get: function myProperty() {
            if (!this.memory.coordinates) {
                this.memory.coordinates = WorldMap.getRoomCoordinates(this.name);
            }
            return this.memory.coordinates;
        }
    });
    Object.defineProperty(Room.prototype, "defaultMatrix", {
        get: function myProperty() {
            return empire.traveler.getStructureMatrix(this);
        }
    });
    Object.defineProperty(Room.prototype, "fleeObjects", {
        get: function myProperty() {
            if (!Game.cache.fleeObjects[this.name]) {
                let fleeObjects = _.filter(this.hostiles, (c) => {
                    if (c instanceof Creep) {
                        return _.find(c.body, (part) => {
                            return part.type === ATTACK || part.type === RANGED_ATTACK;
                        }) !== null;
                    }
                    else {
                        return true;
                    }
                });
                if (this.roomType === ROOMTYPE_SOURCEKEEPER) {
                    fleeObjects = fleeObjects.concat(this.lairThreats);
                }
                Game.cache.fleeObjects[this.name] = fleeObjects;
            }
            return Game.cache.fleeObjects[this.name];
        }
    });
    Object.defineProperty(Room.prototype, "lairThreats", {
        get: function myProperty() {
            if (!Game.cache.lairThreats[this.name]) {
                Game.cache.lairThreats[this.name] = _.filter(this.findStructures(STRUCTURE_KEEPER_LAIR), (lair) => { return !lair.ticksToSpawn || lair.ticksToSpawn < 10; });
            }
            return Game.cache.lairThreats[this.name];
        }
    });
}

function initRoomPositionPrototype() {
    RoomPosition.prototype.isNearExit = function (range) {
        return this.x - range <= 0 || this.x + range >= 49 || this.y - range <= 0 || this.y + range >= 49;
    };
    RoomPosition.prototype.getFleeOptions = function (roomObject) {
        let fleePositions = [];
        let currentRange = this.getRangeTo(roomObject);
        for (let i = 1; i <= 8; i++) {
            let fleePosition = this.getPositionAtDirection(i);
            if (fleePosition.x > 0 && fleePosition.x < 49 && fleePosition.y > 0 && fleePosition.y < 49) {
                let rangeToHostile = fleePosition.getRangeTo(roomObject);
                if (rangeToHostile > 0) {
                    if (rangeToHostile < currentRange) {
                        fleePosition["veryDangerous"] = true;
                    }
                    else if (rangeToHostile === currentRange) {
                        fleePosition["dangerous"] = true;
                    }
                    fleePositions.push(fleePosition);
                }
            }
        }
        return fleePositions;
    };
    RoomPosition.prototype.bestFleePosition = function (hostile, ignoreRoads = false, swampRat = false) {
        let options = [];
        let fleeOptions = this.getFleeOptions(hostile);
        for (let i = 0; i < fleeOptions.length; i++) {
            let option = fleeOptions[i];
            let terrain = option.lookFor(LOOK_TERRAIN)[0];
            if (terrain !== "wall") {
                let creepsInTheWay = option.lookFor(LOOK_CREEPS);
                if (creepsInTheWay.length === 0) {
                    let structures = option.lookFor(LOOK_STRUCTURES);
                    let hasRoad = false;
                    let impassible = false;
                    for (let structure of structures) {
                        if (_.includes(OBSTACLE_OBJECT_TYPES, structure.structureType)) {
                            // can't go through it
                            impassible = true;
                            break;
                        }
                        if (structure.structureType === STRUCTURE_ROAD) {
                            hasRoad = true;
                        }
                    }
                    if (!impassible) {
                        let preference = 0;
                        if (option.dangerous) {
                            preference += 10;
                        }
                        else if (option.veryDangerous) {
                            preference += 20;
                        }
                        if (hasRoad) {
                            if (ignoreRoads) {
                                preference += 2;
                            }
                            else {
                                preference += 1;
                            }
                        }
                        else if (terrain === "plain") {
                            preference += 2;
                        }
                        else if (terrain === "swamp") {
                            if (swampRat) {
                                preference += 1;
                            }
                            else {
                                preference += 5;
                            }
                        }
                        options.push({ position: option, preference: preference });
                    }
                }
            }
        }
        if (options.length > 0) {
            options = _(options)
                .shuffle()
                .sortBy("preference")
                .value();
            return options[0].position;
        }
    };
    /**
     * Returns all surrounding positions that are currently open
     * @param ignoreCreeps - if true, will consider positions containing a creep to be open
     * @returns {RoomPosition[]}
     */
    RoomPosition.prototype.openAdjacentSpots = function (ignoreCreeps) {
        let positions = [];
        for (let i = 1; i <= 8; i++) {
            let testPosition = this.getPositionAtDirection(i);
            if (testPosition.isPassible(ignoreCreeps)) {
                // passed all tests
                positions.push(testPosition);
            }
        }
        return positions;
    };
    /**
     * returns position at direction relative to this position
     * @param direction
     * @param range - optional, can return position with linear distance > 1
     * @returns {RoomPosition}
     */
    RoomPosition.prototype.getPositionAtDirection = function (direction, range) {
        if (!range) {
            range = 1;
        }
        let x = this.x;
        let y = this.y;
        let room = this.roomName;
        if (direction === 1) {
            y -= range;
        }
        else if (direction === 2) {
            y -= range;
            x += range;
        }
        else if (direction === 3) {
            x += range;
        }
        else if (direction === 4) {
            x += range;
            y += range;
        }
        else if (direction === 5) {
            y += range;
        }
        else if (direction === 6) {
            y += range;
            x -= range;
        }
        else if (direction === 7) {
            x -= range;
        }
        else if (direction === 8) {
            x -= range;
            y -= range;
        }
        return new RoomPosition(x, y, room);
    };
    /**
     * Look if position is currently open/passible
     * @param ignoreCreeps - if true, consider positions containing creeps to be open
     * @returns {boolean}
     */
    RoomPosition.prototype.isPassible = function (ignoreCreeps) {
        if (this.isNearExit(0))
            return false;
        // look for walls
        if (_.head(this.lookFor(LOOK_TERRAIN)) !== "wall") {
            // look for creeps
            if (ignoreCreeps || this.lookFor(LOOK_CREEPS).length === 0) {
                // look for impassible structions
                if (_.filter(this.lookFor(LOOK_STRUCTURES), (struct) => {
                    return struct.structureType !== STRUCTURE_ROAD
                        && struct.structureType !== STRUCTURE_CONTAINER
                        && struct.structureType !== STRUCTURE_RAMPART;
                }).length === 0) {
                    // passed all tests
                    return true;
                }
            }
        }
        return false;
    };
    /**
     * @param structureType
     * @returns {Structure} structure of type structureType that resides at position (null if no structure of that type is present)
     */
    RoomPosition.prototype.lookForStructure = function (structureType) {
        let structures = this.lookFor(LOOK_STRUCTURES);
        return _.find(structures, { structureType: structureType });
    };
}

function initPrototypes() {
    initRoomPrototype();
    initRoomPositionPrototype();
    // misc prototype modifications
    /**
     * Will remember an instance of structureType that it finds within range, good for storing mining containers, etc.
     * There should only be one instance of that structureType within range, per object
     * @param structureType
     * @param range
     * @param immediate
     * @returns Structure[]
     */
    RoomObject.prototype.findMemoStructure = function (structureType, range, immediate = false) {
        if (!this.room.memory[structureType])
            this.room.memory[structureType] = {};
        if (this.room.memory[structureType][this.id]) {
            let structure = Game.getObjectById(this.room.memory[structureType][this.id]);
            if (structure) {
                return structure;
            }
            else {
                this.room.memory[structureType][this.id] = undefined;
                return this.findMemoStructure(structureType, range, immediate);
            }
        }
        else if (Game.time % 10 === 7 || immediate) {
            let structures = this.pos.findInRange(this.room.findStructures(structureType), range);
            if (structures.length > 0) {
                this.room.memory[structureType][this.id] = structures[0].id;
            }
        }
    };
    /**
     * Looks for structure to be used as an energy holder for upgraders
     * @returns { StructureLink | StructureStorage | StructureContainer }
     */
    StructureController.prototype.getBattery = function (structureType) {
        if (this.room.memory.controllerBatteryId) {
            let batt = Game.getObjectById(this.room.memory.controllerBatteryId);
            if (batt) {
                return batt;
            }
            else {
                this.room.memory.controllerBatteryId = undefined;
                this.room.memory.upgraderPositions = undefined;
            }
        }
        else {
            let battery = _(this.pos.findInRange(FIND_STRUCTURES, 3))
                .filter((structure) => {
                if (structureType) {
                    return structure.structureType === structureType;
                }
                else {
                    if (structure.structureType === STRUCTURE_CONTAINER || structure.structureType === STRUCTURE_LINK) {
                        let sourcesInRange = structure.pos.findInRange(FIND_SOURCES, 2);
                        return sourcesInRange.length === 0;
                    }
                }
            })
                .head();
            if (battery) {
                this.room.memory.controllerBatteryId = battery.id;
                return battery;
            }
        }
    };
    /**
     * Positions on which it is viable for an upgrader to stand relative to battery/controller
     * @returns {Array}
     */
    StructureController.prototype.getUpgraderPositions = function () {
        if (this.upgraderPositions) {
            return this.upgraderPositions;
        }
        else {
            if (this.room.memory.upgraderPositions) {
                this.upgraderPositions = [];
                for (let position of this.room.memory.upgraderPositions) {
                    this.upgraderPositions.push(helper.deserializeRoomPosition(position));
                }
                return this.upgraderPositions;
            }
            else {
                let controller = this;
                let battery = this.getBattery();
                if (!battery) {
                    return;
                }
                let positions = [];
                for (let i = 1; i <= 8; i++) {
                    let position = battery.pos.getPositionAtDirection(i);
                    if (!position.isPassible(true) || !position.inRangeTo(controller, 3)
                        || position.lookFor(LOOK_STRUCTURES).length > 0)
                        continue;
                    positions.push(position);
                }
                this.room.memory.upgraderPositions = positions;
                return positions;
            }
        }
    };
    StructureObserver.prototype._observeRoom = StructureObserver.prototype.observeRoom;
    StructureObserver.prototype.observeRoom = function (roomName, purpose = "unknown", override = false) {
        let makeObservation = (observation) => {
            this.observation; // load the current observation before overwriting
            this.room.memory.observation = observation;
            this.alreadyObserved = true;
            return this._observeRoom(observation.roomName);
        };
        if (override) {
            return makeObservation({ roomName: roomName, purpose: purpose });
        }
        else {
            if (!this.room.memory.obsQueue)
                this.room.memory.obsQueue = [];
            let queue = this.room.memory.obsQueue;
            if (!_.find(queue, (item) => item.purpose === purpose)) {
                queue.push({ purpose: purpose, roomName: roomName });
            }
            if (!this.alreadyObserved) {
                return makeObservation(queue.shift());
            }
            else {
                return OK;
            }
        }
    };
    Object.defineProperty(StructureObserver.prototype, "observation", {
        get: function () {
            if (!this._observation) {
                let observation = this.room.memory.observation;
                if (observation) {
                    let room = Game.rooms[observation.roomName];
                    if (room) {
                        observation.room = room;
                        this._observation = observation;
                    }
                }
            }
            return this._observation;
        }
    });
    StructureTerminal.prototype._send = StructureTerminal.prototype.send;
    StructureTerminal.prototype.send = function (resourceType, amount, roomName, description) {
        if (this.alreadySent) {
            return ERR_BUSY;
        }
        else {
            this.alreadySent = true;
            return this._send(resourceType, amount, roomName, description);
        }
    };
    StructureTower.prototype._repair = StructureTower.prototype.repair;
    StructureTower.prototype.repair = function (target) {
        if (!this.alreadyFired) {
            this.alreadyFired = true;
            return this._repair(target);
        }
        else {
            return ERR_BUSY;
        }
    };
    Creep.prototype.partCount = function (partType) {
        let count = 0;
        for (let part of this.body) {
            if (part.type === partType) {
                count++;
            }
        }
        return count;
    };
    /**
     * General-purpose cpu-efficient movement function that uses ignoreCreeps: true, a high reusePath value and stuck-detection
     * @param destination
     * @param ops - pathfinding ops, ignoreCreeps and reusePath will be overwritten
     * @param dareDevil
     * @returns {number} - Error code
     */
    Creep.prototype.blindMoveTo = function (destination, ops, dareDevil = false) {
        if (this.spawning) {
            return 0;
        }
        if (this.fatigue > 0) {
            return ERR_TIRED;
        }
        if (!this.memory.position) {
            this.memory.position = this.pos;
        }
        if (!ops) {
            ops = {};
        }
        // check if trying to move last tick
        let movingLastTick = true;
        if (!this.memory.lastTickMoving)
            this.memory.lastTickMoving = 0;
        if (Game.time - this.memory.lastTickMoving > 1) {
            movingLastTick = false;
        }
        this.memory.lastTickMoving = Game.time;
        // check if stuck
        let stuck = this.pos.inRangeTo(this.memory.position.x, this.memory.position.y, 0);
        this.memory.position = this.pos;
        if (stuck && movingLastTick) {
            if (!this.memory.stuckCount)
                this.memory.stuckCount = 0;
            this.memory.stuckCount++;
            if (dareDevil && this.memory.stuckCount > 0) {
                this.memory.detourTicks = 5;
            }
            else if (this.memory.stuckCount >= 2) {
                this.memory.detourTicks = 5;
                // this.say("excuse me", true);
            }
            if (this.memory.stuckCount > 500 && !this.memory.stuckNoted) {
                console.log(this.name, "is stuck at", this.pos, "stuckCount:", this.memory.stuckCount);
                this.memory.stuckNoted = true;
            }
        }
        else {
            this.memory.stuckCount = 0;
        }
        if (this.memory.detourTicks > 0) {
            this.memory.detourTicks--;
            if (dareDevil) {
                ops.reusePath = 0;
            }
            else {
                ops.reusePath = 5;
            }
            return this.moveTo(destination, ops);
        }
        else {
            ops.reusePath = 50;
            ops.ignoreCreeps = true;
            return this.moveTo(destination, ops);
        }
    };
}

loopHelper.initMemory();
initPrototypes();
module.exports.loop = function () {
    Game.cache = { structures: {}, hostiles: {}, hostilesAndLairs: {}, mineralCount: {}, labProcesses: {},
        activeLabCount: 0, placedRoad: false, fleeObjects: {}, lairThreats: {} };
    // TimeoutTracker - Diagnoses CPU timeouts
    try {
        TimeoutTracker.init();
    }
    catch (e) {
        console.log("error initializing TimeoutTracker:\n", e.stack);
    }
    // Init phase - Information is gathered about the game state and game objects instantiated
    Profiler.start("init");
    loopHelper.initEmpire();
    let operations = loopHelper.getOperations(empire);
    for (let operation of operations)
        operation.init();
    Profiler.end("init");
    // RoleCall phase - Find creeps belonging to missions and spawn any additional needed.
    Profiler.start("roleCall");
    for (let operation of operations)
        operation.roleCall();
    Profiler.end("roleCall");
    // Actions phase - Actions that change the game state are executed in this phase.
    Profiler.start("actions");
    for (let operation of operations)
        operation.actions();
    Profiler.end("actions");
    // Finalize phase - Code that needs to run post-actions phase
    for (let operation of operations)
        operation.invalidateCache();
    Profiler.start("finalize");
    for (let operation of operations)
        operation.finalize();
    Profiler.end("finalize");
    // post-operation actions and utilities
    Profiler.start("postOperations");
    try {
        empire.actions();
    }
    catch (e) {
        console.log("error with empire actions\n", e.stack);
    }
    try {
        loopHelper.scavangeResources();
    }
    catch (e) {
        console.log("error scavanging:\n", e.stack);
    }
    try {
        loopHelper.initConsoleCommands();
    }
    catch (e) {
        console.log("error loading console commands:\n", e.stack);
    }
    try {
        loopHelper.garbageCollection();
    }
    catch (e) {
        console.log("error during garbage collection:\n", e.stack);
    }
    Profiler.end("postOperations");
    try {
        Profiler.finalize();
    }
    catch (e) {
        console.log("error checking Profiler:\n", e.stack);
    }
    try {
        TimeoutTracker.finalize();
    }
    catch (e) {
        console.log("error finalizing TimeoutTracker:\n", e.stack);
    }
};
//# sourceMappingURL=main.js.map
