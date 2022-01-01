import { Server, Socket } from 'socket.io'
import * as dotenv from 'dotenv'
import { DefaultEventsMap } from 'socket.io/dist/typed-events'

interface IClientData {
    user_id: string
    name: string
}

dotenv.config()
const io = new Server({ /* options */ })
const connections: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByName: { [name: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } = {}
const connectionsByGroupId: { [group_id: string]: { [id: string]: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData> } } = {}

function GroupLeave(group_id: string | undefined, user_id: string | undefined) {
    // Validate group
    if (!group_id) {
        return
    }
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
        return
    }
    // Validate user
    if (!user_id) {
        return
    }
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
        return
    }
    // TODO: Delete user's group data from database

    // Remove user from the group
    connections[user_id].emit("group-left")
    delete connectionsByGroupId[group_id][user_id]
};

io.on("connection", (socket: Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, IClientData>) => {
    // TODO: If the client is not allowed, disconnect
    socket.disconnect(true)

    // TODO: Retrieve IDs after connected
    let user_id = ""
    let name = ""
    let group_id = ""
    socket.data.user_id = user_id
    socket.data.name = name

    // Set socket client to the collections
    connections[user_id] = socket
    connectionsByName[name] = socket
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
        connectionsByGroupId[group_id] = {}
    }
    if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
        connectionsByGroupId[group_id][user_id] = socket
    }

    socket.on("local", (data) => {
        io.emit("local", {
            "name": name,
            "msg": data.msg,
            "map": data.map,
            "x": data.x,
            "y": data.y,
            "z": data.z,
        })
    })

    socket.on("global", (data) => {
        io.emit("global", {
            "name": name,
            "msg": data.msg,
        })
    })

    socket.on("whisper", (data) => {
        const targetName = data.target_name
        const targetClient = connectionsByName[targetName]
        targetClient.emit("whisper", {
            "name": targetClient.data.name,
            "msg": data.msg,
        })
    })

    socket.on("group", (data) => {
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            return
        }
        const targetClients = connectionsByGroupId[group_id]
        for (const user_id in targetClients) {
            const targetClient = targetClients[user_id]
            targetClient.emit("group", {
                "group_id": group_id,
                "name": targetClient.data.name,
                "msg": data.msg,
            })
        }
    })

    socket.on("create-group", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }

        const group_id = ""
        const title = data.title
        const icon_url = data.icon_url
        // TODO: Insert group data to database
        
        connectionsByGroupId[group_id] = {}
        connectionsByGroupId[group_id][user_id] = socket

        socket.emit("group-created", {
            "group_id": group_id,
            "title": title,
            "icon_url": icon_url,
        })
    })

    socket.on("update-group", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            return
        }
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId[group_id], user_id)) {
            return
        }

        const title = data.title
        const icon_url = data.icon_url
        // TODO: Update group data at database
        
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

    socket.on("group-invite", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        // TODO: Create invitation
    })

    socket.on("group-invite-accept", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // TODO: Validate invitation
        if (!Object.prototype.hasOwnProperty.call(connectionsByGroupId, group_id)) {
            connectionsByGroupId[group_id] = {}
        }
        connectionsByGroupId[group_id][user_id] = socket
    })

    socket.on("group-invite-decline", (data) => {
        const user_id = socket.data.user_id
        if (!user_id) {
            return
        }
        const group_id = data.group_id
        if (!group_id) {
            return
        }
        // TODO: Validate invitation
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

const port = Number(process.env.SERVER_PORT || 8212);
io.listen(port);