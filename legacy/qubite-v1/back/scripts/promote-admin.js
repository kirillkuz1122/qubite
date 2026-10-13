#!/usr/bin/env node

const { DATABASE_PATH } = require("../src/config");
const {
    findUserByLoginOrEmail,
    findUserByUid,
    initializeDatabase,
    promoteUserToAdmin,
} = require("../src/db");
const { normalizeEmail, normalizeLogin } = require("../src/security");

function parseArgs(argv) {
    const args = {
        uid: "",
        login: "",
        email: "",
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
        }
    }

    return args;
}

function printUsage() {
    console.error(
        "Usage: node back/scripts/promote-admin.js (--uid <UID> | --login <login> | --email <email>)",
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

    if ((user.status || "active") !== "active") {
        console.error("Only active users can be promoted to admin.");
        process.exitCode = 1;
        return;
    }

    try {
        const updated = await promoteUserToAdmin(user.id);
        if (!updated) {
            console.error("Failed to promote user.");
            process.exitCode = 1;
            return;
        }

        console.log(
            `User promoted to admin on database ${DATABASE_PATH}: @${updated.login} (${updated.email})`,
        );
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

main();
