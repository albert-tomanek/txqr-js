#include "wrapper.h"

using namespace TxQR;

Encoder::Encoder(QObject *parent) :
	QJSEngine{parent},
	m_data()
{
	installExtensions(QJSEngine::ConsoleExtension);

	QJSValue mod = importModule(":/dist/txqr.mjs");
	if (mod.isError())
		qWarning() << "txqr load failed:" << mod.toString();
	globalObject().setProperty("TxQR", mod);
	evaluate("var instance = 0;");

	connect(this, &Encoder::dataChanged, this, &Encoder::rebuildEncoder);

	connect(this, &Encoder::chunkSizeChanged, this, &Encoder::rebuildEncoder);
	connect(this, &Encoder::redundancyChanged, this, &Encoder::rebuildEncoder);
	connect(this, &Encoder::eccChanged, this, &Encoder::rebuildEncoder);
}

void Encoder::rebuildEncoder()
{
	QJSValue bytes = globalObject().property("Uint8Array").callAsConstructor(QJSValueList{
		toScriptValue(this->data())
	});
	globalObject().setProperty("bytes", bytes);

	evaluate(
		QString("instance = new TxQR.Encoder(bytes, { chunkSize: %1, redundancy: %2, ecc: \"%3\" });")
			.arg(chunkSize())
			.arg(redundancy())
			.arg(ecc())
	);

	Q_EMIT changed();
}

std::pair<QList<bool>, int> Encoder::renderMatrix(int frame)
{
	auto jsArr = evaluate(QString("instance.renderMatrix(%1);").arg(frame));

	QList<bool> outList;
	quint32 outerLength = jsArr.property("length").toUInt();

	// Reserve memory if possible to avoid reallocations.
	outList.reserve(outerLength * outerLength);

	for (quint32 i = 0; i < outerLength; ++i) {
		QJSValue innerArray = jsArr.property(i);

		if (innerArray.isArray()) {
			quint32 innerLength = innerArray.property("length").toUInt();

			for (quint32 j = 0; j < innerLength; ++j) {
				// Flatten everything directly into the 1D list
				outList.append(innerArray.property(j).toBool());
			}
		}
	}

	return {outList, outerLength};
}
