import { Server, Socket } from 'socket.io'
import * as dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { nanoid } from 'nanoid'
import express from 'express'
import http from 'http'

interface IClientData {
    user_id: string
    name: string
    connectionKey: string
}

dotenv.config()
const prisma = new PrismaClient()
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const connectingUsers: { [id: string]: IClientData } = {}
const connections: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByName: { [name: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByGroupId: { [group_id: string]: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } } = {}

async function GroupLeave(group_id: string | undefined, user_id: string | undefined) {
    // Validate group
    if (!group_id) {
        return
    }
    // Validate user
    if (!user_id) {
        return
    }
    // Delete user's group data from database
    await prisma.userGroup.deleteMany({
        where: {
            userId: user_id,
            groupId: group_id,
        }
    })
    // Valiate before send group moving message to clients
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
        return
    }
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
        return
    }
    // Remove user from the group
    if (Object.prototype.hasOwnProperty.call(connections, user_id)) {
        connections[user_id].emit("group-left")
    }
    delete connectionsByGroupId[group_id][user_id]
}

io.on("connection", async (socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData>) => {

    socket.on("validate-user", async (data) => {
        const user_id = data.user_id
        if (!user_id) {
            return
        }
        // If the client is not allowed, disconnect
        if (!Object.prototype.hasOwnProperty.call(connectingUsers, user_id)) {
            socket.disconnect(true)
            return
        }

        // Validate connection key
        const connectingUser = connectingUsers[user_id]
        const connectionKey = data.connection_key
        if (connectionKey != connectingUser.connectionKey) {
            socket.disconnect(true)
            return
        }

        // Set user data after connected
        socket.data = connectingUser

        // Set socket client to the collections
        connections[user_id] = socket
        connectionsByName[connectingUser.name] = socket

        // Find and store user groups
        const userGroups = await prisma.userGroup.findMany({
            where: {
                userId: user_id
            }
        })
        userGroups.forEach(userGroup => {
            if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, userGroup.groupId)) {
                connectionsByGroupId[userGroup.groupId] = {}
            }
            if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[userGroup.groupId], user_id)) {
                connectionsByGroupId[userGroup.groupId][user_id] = socket
            }
        })
    })

    socket.on("local", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        io.emit("local", {
            "user_id": user_id,
            "name": socket.data.name,
            "msg": data.msg,
            "map": data.map,
            "x": data.x,
            "y": data.y,
            "z": data.z,
        })
    })

    socket.on("global", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        io.emit("global", {
            "user_id": user_id,
            "name": socket.data.name,
            "msg": data.msg,
        })
    })

    socket.on("whisper", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const targetName = data.target_name
        if (!Object.prototype.hasOwnProperty.call(connectionsByName, targetName)) {
            return
        }
        const targetClient = connectionsByName[targetName]
        targetClient.emit("whisper", {
            "user_id": user_id,
            "name": socket.data.name,
            "msg": data.msg,
        })
        socket.emit("whisper", {
            "user_id": user_id,
            "name": socket.data.name,
            "msg": data.msg,
        })
    })

    socket.on("group", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            return
        }
        // User is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
            return
        }
        const targetClients = connectionsByGroupId[group_id]
        for (const user_id in targetClients) {
            const targetClient = targetClients[user_id]
            targetClient.emit("group", {
                "group_id": group_id,
                "user_id": user_id,
                "name": targetClient.data.name,
                "msg": data.msg,
            })
        }
    })

    socket.on("create-group", async (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = nanoid(8)
        const title = data.title
        const icon_url = data.icon_url
        // Insert group data to database
        await prisma.group.create({
            data: {
                groupId: group_id,
                title: title,
                iconUrl: icon_url,
            }
        })
        // Add user to the group
        await prisma.userGroup.deleteMany({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        await prisma.userGroup.create({
            data: {
                userId: user_id,
                groupId: group_id,
            }
        })
        connectionsByGroupId[group_id] = {}
        connectionsByGroupId[group_id][user_id] = socket
        // Tell the client that the group was created
        socket.emit("create-group", {
            "group_id": group_id,
            "title": title,
            "icon_url": icon_url,
        })
    })

    socket.on("update-group", async (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            return
        }
        // User is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
            return
        }
        // Update group data at database
        const title = data.title
        const icon_url = data.icon_url
        await prisma.group.update({
            where: {
                groupId: group_id,
            },
            data: {
                title: title,
                iconUrl: icon_url
            },
        })
        // Tell the clients that the group was updated
        const targetClients = connectionsByGroupId[group_id]
        for (const user_id in targetClients) {
            const targetClient = targetClients[user_id]
            targetClient.emit("update-group", {
                "group_id": group_id,
                "title": title,
                "icon_url": icon_url,
            })
        }
    })

    socket.on("group-invitation-list", async (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const invitationList = await prisma.userGroupInvitation.findMany({
            where: {
                userId: user_id,
            }
        })
        socket.emit("group-invitation-list", {
            list: invitationList
        })
    })

    socket.on("group-invite", async (data) => {
        const inviter_id = socket.data.user_id
        if (!inviter_id) {
            return
        }
        const user_id = data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // Has the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            return
        }
        // Inviter is in the group?
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], inviter_id)) {
            return
        }
        // Create invitation
        await prisma.userGroupInvitation.deleteMany({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        await prisma.userGroupInvitation.create({
            data: {
                userId: user_id,
                groupId: group_id,
            }
        })
        // Send notification message to user
        if (Object.prototype.hasOwnProperty.call(connections, user_id)) {
            connections[user_id].emit("notify-group-invitation")
        }
    })

    socket.on("group-invite-accept", async (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // Validate invitation
        const countInvitation = await prisma.userGroupInvitation.count({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        if (countInvitation == 0) {
            return
        }
        // Delete invitation
        await prisma.userGroupInvitation.deleteMany({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        // Add user to the group
        await prisma.userGroup.deleteMany({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        await prisma.userGroup.create({
            data: {
                userId: user_id,
                groupId: group_id,
            }
        })
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            connectionsByGroupId[group_id] = {}
        }
        connectionsByGroupId[group_id][user_id] = socket
        // Broadcast new member
        const targetClients = connectionsByGroupId[group_id]
        for (const user_id in targetClients) {
            const targetClient = targetClients[user_id]
            targetClient.emit("group-join", {
                "group_id": group_id,
                "user_id": targetClient.data.user_id,
                "name": targetClient.data.name,
            })
        }
        // Send notification message to user
        socket.emit("notify-group-invitation")
    })

    socket.on("group-invite-decline", async (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // Validate invitation
        const countInvitation = await prisma.userGroupInvitation.count({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        if (countInvitation == 0) {
            return
        }
        // Delete invitation
        await prisma.userGroupInvitation.deleteMany({
            where: {
                userId: user_id,
                groupId: group_id,
            }
        })
        // Send notification message to user
        socket.emit("notify-group-invitation")
    })

    socket.on("leave-group", (data) => {
        const group_id = data.group_id
        GroupLeave(group_id, socket.data.user_id)
    })

    socket.on("kick-user", (data) => {
        const group_id = data.group_id
        GroupLeave(group_id, data.user_id)
    })
})

app.post('/add-user', (req, res) => {
    // This must be able to connect by game-server only, don't allow client to connect
    // Validate connection by secret key which will be included in header -> authorization
    // TODO: Implements middleware if there are more than 1 function which will validate authorization like this
    const bearerHeader = req.headers['authorization']
    if (!bearerHeader) {
        res.sendStatus(400)
        return
    }
    // Substring `bearer `, length is 7, index is 6
    const bearerToken = bearerHeader.substring(6)
    const secretKeys: string[] = JSON.parse(process.env.SECRET_KEYS || "[]")
    if (secretKeys.indexOf(bearerToken) < 0) {
        res.sendStatus(400)
        return
    }
    // Token is correct, then create user connection data
    const connectingUser = {
        user_id: req.body.user_id,
        name: req.body.name,
        connectionKey: nanoid(6),
    } as IClientData
    connectingUsers[connectingUser.user_id] = connectingUser
    // Send response back
    res.status(200).send(connectingUser)
});

const port = Number(process.env.SERVER_PORT || 8215)
server.listen(port, () => {
    console.log("Simple chat server listening on :" + port)
})