#!/usr/bin/env node

const { DATABASE_PATH } = require("../src/config");
const {
    findUserByLoginOrEmail,
    findUserByUid,
    getOwnerUser,
    initializeDatabase,
    setOwnerUser,
} = require("../src/db");
const { normalizeEmail, normalizeLogin } = require("../src/security");

function parseArgs(argv) {
    const args = {
        uid: "",
        login: "",
        email: "",
        replace: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = String(argv[index] || "");
        const next = String(argv[index + 1] || "");

        if (current === "--uid") {
            args.uid = next.trim();
            index += 1;
            continue;
        }

        if (current === "--login") {
            args.login = next.trim();
            index += 1;
            continue;
        }

        if (current === "--email") {
            args.email = next.trim();
            index += 1;
            continue;
        }

        if (current === "--replace") {
            args.replace = true;
        }
    }

    return args;
}

function printUsage() {
    console.error(
        "Usage: node back/scripts/set-owner.js (--uid <UID> | --login <login> | --email <email>) [--replace]",
    );
}

async function findTargetUser(args) {
    if (args.uid) {
        return findUserByUid(args.uid);
    }

    if (args.login) {
        return findUserByLoginOrEmail(normalizeLogin(args.login));
    }

    if (args.email) {
        return findUserByLoginOrEmail(normalizeEmail(args.email));
    }

    return null;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const identifiersCount = [args.uid, args.login, args.email].filter(Boolean).length;
    if (identifiersCount !== 1) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    await initializeDatabase({ seedDemoData: false });
    const user = await findTargetUser(args);
    if (!user) {
        console.error(`User not found in database ${DATABASE_PATH}`);
        process.exitCode = 1;
        return;
    }

    try {
        const result = await setOwnerUser(user.id, { replace: args.replace });
        const owner = result?.currentOwner;
        if (!owner) {
            console.error("Failed to assign owner.");
            process.exitCode = 1;
            return;
        }

        if (!result.changed) {
            console.log(
                `Owner unchanged: @${owner.login} (${owner.email}) on database ${DATABASE_PATH}`,
            );
            return;
        }

        console.log(`Owner assigned on database ${DATABASE_PATH}`);
        if (result.previousOwner) {
            console.log(
                `Previous owner demoted to admin: @${result.previousOwner.login} (${result.previousOwner.email})`,
            );
        }
        console.log(`Current owner: @${owner.login} (${owner.email})`);
    } catch (error) {
        if (error.code === "OWNER_EXISTS") {
            const currentOwner = await getOwnerUser();
            console.error(
                currentOwner
                    ? `Owner already exists: @${currentOwner.login} (${currentOwner.email}). Re-run with --replace to transfer ownership.`
                    : "Owner already exists. Re-run with --replace to transfer ownership.",
            );
            process.exitCode = 1;
            return;
        }

        console.error(error.message || error);
        process.exitCode = 1;
    }
}

main();
