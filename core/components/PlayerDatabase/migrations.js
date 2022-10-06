const modulename = 'DBMigration';
import { genActionID } from './idGenerator.js';
import cleanPlayerName from '@core/../shared/cleanPlayerName.js';
import logger from '@core/extras/console.js';
import { DATABASE_VERSION, defaultDatabase } from './database.js';
const { dir, log, logOk, logWarn, logError } = logger(modulename);

//Helper
const now = () => { return Math.round(Date.now() / 1000); };


/**
 * Handles the migration of the database
 */
export default async (dbo) => {
    if (dbo.data.version === DATABASE_VERSION) {
        return dbo;
    }
    if (typeof dbo.data.version !== 'number') {
        logError('Your players database version is not a number!');
        process.exit(1);
    }
    if (dbo.data.version > DATABASE_VERSION) {
        logError(`Your players database is on v${dbo.data.version}, and this txAdmin supports up to v${DATABASE_VERSION}.`);
        logError('This means you likely downgraded your txAdmin version. Please update txAdmin.');
        process.exit(1);
    }

    //Migrate database
    if (dbo.data.version < 1) {
        logWarn(`Migrating your players database from v${dbo.data.version} to v1. Wiping all the data.`);
        dbo.data = lodash.cloneDeep(defaultDatabase);
        dbo.data.version = 1;
        await dbo.write();
    }


    if (dbo.data.version === 1) {
        logWarn('Migrating your players database from v1 to v2.');
        logWarn('This process will change any duplicated action ID and wipe pending whitelist.');
        const actionIDStore = new Set();
        const actionsToFix = [];
        dbo.chain.get('actions').forEach((a) => {
            if (!actionIDStore.has(a.id)) {
                actionIDStore.add(a.id);
            } else {
                actionsToFix.push(a);
            }
        }).value();
        logWarn(`Actions to fix: ${actionsToFix.length}`);
        for (let i = 0; i < actionsToFix.length; i++) {
            const action = actionsToFix[i];
            action.id = genActionID(actionIDStore, action.type);
            actionIDStore.add(action.id);
        }
        dbo.data.pendingWL = [];
        dbo.data.version = 2;
        await dbo.write();
    }

    if (dbo.data.version === 2) {
        logWarn('Migrating your players database from v2 to v3.');
        logWarn('This process will:');
        logWarn('\t- process player names for better readability/searchability');
        logWarn('\t- allow txAdmin to save old player identifiers');
        logWarn('\t- remove the whitelist action in favor of player property');
        logWarn('\t- remove empty notes');

        //Removing all whitelist actions
        const ts = now();
        const whitelists = new Map();
        dbo.data.actions = dbo.data.actions.filter((action) => {
            if (action.type !== 'whitelist') return true;
            if (
                (!action.expiration || action.expiration > ts)
                && (!action.revocation.timestamp)
                && action.identifiers.length
                && typeof action.identifiers[0] === 'string'
                && action.identifiers[0].startsWith('license:')
            ) {
                const license = action.identifiers[0].substring(8);
                whitelists.set(license, action.timestamp);
            }
            return false;
        });

        //Migrating players
        for (const player of dbo.data.players) {
            const { displayName, pureName } = cleanPlayerName(player.name);
            player.displayName = displayName;
            player.pureName = pureName;
            player.name = undefined;
            player.ids = [`license:${player.license}`];
            
            //adding whitelist
            const tsWhitelisted = whitelists.get(player.license);
            if (tsWhitelisted) player.tsWhitelisted = tsWhitelisted;
            
            //removing empty notes
            if (!player.notes.text) player.notes = undefined;
        }

        dbo.data.version = 3;
        await dbo.write();
    }

    if (dbo.data.version !== DATABASE_VERSION) {
        logError(`Your players database is on v${dbo.data.version}, which is different from this version of txAdmin (v${DATABASE_VERSION}).`);
        logError('Since there is currently no migration method ready for the migration, txAdmin will attempt to use it anyways.');
        logError('Please make sure your txAdmin is on the most updated version!');
        process.exit(1);
    }
    logOk('Database migrated successfully')
    return dbo;
};
