import {SpawnGroup} from "./SpawnGroup";
import {notifier} from "../notifier";
import {Profiler} from "../Profiler";
import {Traveler, traveler} from "./Traveler";
import {WorldMap} from "./WorldMap";
import {Diplomat} from "./Diplomat";
import {TimeoutTracker} from "../TimeoutTracker";

export class Empire {

    spawnGroups: {[roomName: string]: SpawnGroup};
    memory: {
        errantConstructionRooms: {};
    };

    public traveler: Traveler;
    public diplomat: Diplomat;
    public map: WorldMap;

    constructor() {
        if (!Memory.empire) Memory.empire = {};
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

    getSpawnGroup(roomName: string) {
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

    private clearErrantConstruction() {
        if (Game.time % 1000 !== 0) { return; }

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

    spawnFromClosest(pos: RoomPosition, body: string[], name: string) {
        let closest: SpawnGroup;
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

