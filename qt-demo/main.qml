import QtQuick
import "dist/txqr.mjs" as Txqr

Rectangle {
    color: "#2d6cdf"

    Text {
        anchors.centerIn: parent
        text: "Hello, World!"
        color: "white"
        font.pixelSize: 32
    }

    Component.onCompleted: {
        const enc = new Txqr.Encoder("hello", { chunkSize: 100 })
        console.log(enc.frameCount, Txqr.DEFAULTS.chunkSize)
    }
}
