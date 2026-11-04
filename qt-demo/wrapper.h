#ifndef WRAPPER_H
#define WRAPPER_H

#include <QJSEngine>
#include "props.h"

namespace TxQR {

#define JSPROP_RO(T, name, notifySig) \
Q_PROPERTY(T name READ name() NOTIFY notifySig); \
inline T name() { return evaluate("instance." #name).toVariant().value<T>(); }

#define JSPROP_RO(T, name, notifySig) \
Q_PROPERTY(T name READ name() NOTIFY notifySig); \
inline T name() { return evaluate("instance." #name).toVariant().value<T>(); }

class Encoder : public QJSEngine
{
	Q_OBJECT
public:
	MAKE_PROPERTY(QByteArray, data, Data);

	MAKE_PROPERTY(int, chunkSize, ChunkSize);
	MAKE_PROPERTY(int, redundancy, Redundancy);
	MAKE_PROPERTY(QString, ecc, Ecc);

	JSPROP_RO(int, frameCount, changed);

	explicit Encoder(QObject *parent = nullptr);

	std::pair<QList<bool>, int> renderMatrix(int frame);

Q_SIGNALS:
	void changed();
private Q_SLOTS:
	void rebuildEncoder();
};

}

#endif // WRAPPER_H
