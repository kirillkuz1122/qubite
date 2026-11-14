import QtQuick

Item {
    id: petRoot

    width: 128
    height: 112

    required property color eyeColor
    required property color coatColor
    required property color lightColor
    required property color markColor
    required property bool reducedMotion
    property bool asleep: false
    property bool alternateCoat: false
    property bool near: false
    property bool dragging: false
    property real gazeX: 0
    property real gazeY: 0
    readonly property color fur: alternateCoat ? lightColor : coatColor
    readonly property color muzzle: alternateCoat ? coatColor : lightColor
    readonly property bool eyesClosed: asleep || blink.running || joy.running

    // Авторский силуэт в визуальном языке «Частиц».
    readonly property int columns: 17
    readonly property var face: [
        ".................",
        "..oo.........oo..",
        "..ooo.......ooo..",
        "..omoo.....oomo..",
        "..omooooooooomo..",
        "..ooooooooooooo..",
        ".ooooooooooooooo.",
        ".ooooooooooooooo.",
        ".ooooooooooooooo.",
        ".ooooooooooooooo.",
        ".ooooommmmmooooo.",
        "..oooommmmmoooo..",
        "...ooooooooooo...",
        ".....ooooooo....."
    ]

    signal grabPet(real x, real y)
    signal movePet(real x, real y)
    signal releasePet()
    signal cancelPet()
    signal changeCoat()

    function pet() {
        joy.restart();
        if (!reducedMotion)
            bounce.restart();
    }

    Timer {
        id: blinkClock
        interval: 4200
        repeat: true
        running: petRoot.visible && !petRoot.asleep && !petRoot.reducedMotion
        onTriggered: blink.start()
    }

    Timer { id: blink; interval: 145 }
    Timer { id: joy; interval: 620 }

    Item {
        id: character

        width: 102
        height: 91
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 8

        transform: [
            Translate { id: lift },
            Scale {
                id: breath
                origin.y: character.height
                origin.x: character.width / 2
            }
        ]

        SequentialAnimation {
            running: petRoot.visible && !petRoot.asleep && !petRoot.reducedMotion
            loops: Animation.Infinite
            NumberAnimation { target: breath; property: "yScale"; from: 1; to: 1.022; duration: 2000; easing.type: Easing.InOutSine }
            NumberAnimation { target: breath; property: "yScale"; from: 1.022; to: 1; duration: 2000; easing.type: Easing.InOutSine }
        }

        SequentialAnimation {
            id: bounce
            NumberAnimation { target: lift; property: "y"; to: -10; duration: 200; easing.type: Easing.OutCubic }
            NumberAnimation { target: lift; property: "y"; to: 0; duration: 320; easing.type: Easing.OutBack }
        }

        Repeater {
            model: petRoot.face.join("").length

            Rectangle {
                required property int index
                readonly property string dot: petRoot.face[Math.floor(index / petRoot.columns)][index % petRoot.columns]
                visible: dot !== "."
                x: index % petRoot.columns * 6
                y: Math.floor(index / petRoot.columns) * 6
                width: 5.4
                height: 5.4
                radius: 2.7
                color: dot === "m" ? petRoot.muzzle : petRoot.fur
            }
        }

        Repeater {
            model: [32, 70]

            Item {
                required property int modelData
                x: modelData
                y: 47

                transform: Translate {
                    x: petRoot.eyesClosed ? 0 : petRoot.gazeX
                    y: petRoot.eyesClosed ? 0 : petRoot.gazeY
                    Behavior on x {
                        enabled: !petRoot.reducedMotion
                        NumberAnimation { duration: 110; easing.type: Easing.OutCubic }
                    }
                    Behavior on y {
                        enabled: !petRoot.reducedMotion
                        NumberAnimation { duration: 110; easing.type: Easing.OutCubic }
                    }
                }

                Rectangle {
                    x: -4
                    y: -5
                    width: 8
                    height: 11
                    radius: 4
                    color: petRoot.eyeColor
                    opacity: petRoot.eyesClosed ? 0 : 1
                }
                Rectangle {
                    x: -4
                    width: 8
                    height: 3
                    radius: 1.5
                    color: petRoot.eyeColor
                    opacity: petRoot.eyesClosed ? 1 : 0
                }
            }
        }

        Rectangle {
            x: 48
            y: 59
            width: 6
            height: 4
            radius: 2
            color: petRoot.eyeColor
        }

        Repeater {
            model: [16, 79]

            Rectangle {
                required property int modelData
                x: modelData
                y: 59
                width: 7
                height: 3
                radius: 1.5
                color: petRoot.eyeColor
                opacity: petRoot.near || joy.running ? 0.75 : 0.3
                Behavior on opacity {
                    enabled: !petRoot.reducedMotion
                    NumberAnimation { duration: 160 }
                }
            }
        }
    }

    Repeater {
        model: 3

        Rectangle {
            required property int index
            x: 103 + 5 * index
            y: 28 - 8 * index
            width: 5
            height: 5
            radius: 2.5
            color: petRoot.markColor
            opacity: petRoot.asleep && !petRoot.reducedMotion ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: 180 } }
        }
    }

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        cursorShape: petRoot.dragging ? Qt.ClosedHandCursor : Qt.OpenHandCursor
        onPressed: mouse => {
            if (mouse.button === Qt.LeftButton) {
                const point = mapToGlobal(mouse.x, mouse.y);
                petRoot.grabPet(point.x, point.y);
            }
        }
        onPositionChanged: mouse => {
            if (mouse.buttons & Qt.LeftButton) {
                const point = mapToGlobal(mouse.x, mouse.y);
                petRoot.movePet(point.x, point.y);
            }
        }
        onReleased: mouse => {
            if (mouse.button === Qt.LeftButton)
                petRoot.releasePet();
            else
                petRoot.changeCoat();
        }
        onCanceled: petRoot.cancelPet()
    }
}
