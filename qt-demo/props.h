#pragma once

#include <QObject>
#include <QMetaObject>
#include <QEvent>
#include <QVariant>

/**
 * Create a property in a single line. Inplements m_ member, getter, setter, and nttify signal.
 */

#define MAKE_PROPERTY(type, name, Name)									\
Q_PROPERTY(type name READ name WRITE set##Name NOTIFY name##Changed)	\
	protected:															\
	type m_##name;														\
	public:																\
	type name() const { return m_##name; }								\
	void set##Name(type value) {										\
		m_##name = value;												\
		Q_EMIT name##Changed(m_##name);									\
	}																	\
	Q_SIGNAL void name##Changed(type)

/**
 * Bind a property on one object to a property on another. Akin to g_object_bind_property()
 */

using ConvertFn = std::function<QVariant(QVariant)>;

struct BindingBidi {
	QMetaObject::Connection forward;
	QMetaObject::Connection back;

	inline BindingBidi() {}

	inline void disconnect() {
		if (forward) QObject::disconnect(forward);
		if (back)	 QObject::disconnect(back);
	}
};

/// This lets you treat binding made by bind_prop like normal QObject::connect() bindings.
struct BindingFwd : BindingBidi {
	inline BindingFwd(QMetaObject::Connection conn) {
		forward = conn;
	}

	inline BindingFwd& operator= (const QMetaObject::Connection conn) {
		forward = conn;
		return *this;
	}
	inline operator QMetaObject::Connection() const {
		return forward;
	}
};

template <typename Src, typename NotifyFn>
BindingFwd bind_prop(
	Src* src, const char* SRC_PROP,
	QObject* dst, const char* DST_PROP,
	NotifyFn notify, bool syncOnBind = false, ConvertFn convert = {})
{
	convert = convert ? convert : [](QVariant v) { return v; };

	auto syncFunc = [src, dst, SRC_PROP, DST_PROP, convert](auto&&...) {
		QVariant newValue = convert(src->property(SRC_PROP));
		QVariant oldValue = dst->property(DST_PROP);

		if (newValue != oldValue) // This stops notify loops in bidi binds
			dst->setProperty(DST_PROP, newValue);
	};

	auto binding = QObject::connect(src, notify, dst, syncFunc);	// We pass `dst` as a context object so that the connection is removed when wither src or dst get deleted.

	if (syncOnBind)
		syncFunc();

	return binding;
}

template <typename Src, typename Dst, typename NotifyFn, typename NotifyFnBack>
BindingBidi bind_prop_bidi(
	Src* src, const char* SRC_PROP, NotifyFn notify,
	Dst* dst, const char* DST_PROP, NotifyFnBack notifyBack,
	bool syncOnBind = false,
	ConvertFn convert = {},
	ConvertFn convertBack = {}
	)
{
	BindingBidi binding;
	binding.forward	= bind_prop(src, SRC_PROP, dst, DST_PROP, notify, syncOnBind, convert).forward;
	binding.back	= bind_prop(dst, DST_PROP, src, SRC_PROP, notifyBack, false, convertBack).forward;

	return binding;
}
