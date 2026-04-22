const {
    EMAIL_DELIVERY_MODE,
    EMAIL_FROM,
    EMAIL_REPLY_TO,
    IS_PRODUCTION,
    RESEND_API_KEY,
} = require("./config");
const { logEmailSent } = require("./db");

async function sendEmail(message) {
    const payload = {
        from: EMAIL_FROM,
        to: String(message.to || "").trim(),
        subject: String(message.subject || "").trim(),
        text: String(message.text || "").trim(),
        html: String(message.html || "").trim(),
        replyTo: String(message.replyTo || EMAIL_REPLY_TO || "").trim(),
    };

    let result = { delivered: false };

    try {
        if (EMAIL_DELIVERY_MODE === "log") {
            console.log("[mail:log]", JSON.stringify(payload, null, 2));
            result = {
                delivered: true,
                mode: "log",
                preview: !IS_PRODUCTION,
            };
        } else if (EMAIL_DELIVERY_MODE === "disabled") {
            result = {
                delivered: false,
                mode: "disabled",
                preview: false,
            };
        } else if (EMAIL_DELIVERY_MODE === "resend") {
            if (!RESEND_API_KEY) {
                throw new Error(
                    'EMAIL_DELIVERY_MODE="resend" требует RESEND_API_KEY в `.env`.',
                );
            }

            const resendResponse = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${RESEND_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: payload.from,
                    to: [payload.to],
                    subject: payload.subject,
                    text: payload.text,
                    html: payload.html,
                    reply_to: payload.replyTo || undefined,
                }),
            });

            if (!resendResponse.ok) {
                const errorText = await resendResponse.text();
                throw new Error(`Resend delivery failed: ${errorText}`);
            }

            const resendPayload = await resendResponse.json();
            result = {
                delivered: true,
                mode: "resend",
                providerId: resendPayload.id || null,
                preview: false,
            };
        } else {
            throw new Error(
                `EMAIL_DELIVERY_MODE="${EMAIL_DELIVERY_MODE}" пока не поддерживается без внешнего провайдера.`,
            );
        }

        // Log success
        logEmailSent({
            userId: message.userId || null,
            email: payload.to,
            purpose: message.purpose || "unknown",
            status: "sent"
        }).catch(e => console.error("[mail:db_log_fail]", e));

        return result;

    } catch (error) {
        console.error("Email send error:", error);
        
        // Log failure
        logEmailSent({
            userId: message.userId || null,
            email: payload.to,
            purpose: message.purpose || "unknown",
            status: "failed",
            errorMessage: error.message
        }).catch(e => console.error("[mail:db_log_fail]", e));
        
        throw error;
    }
}

function buildCodeEmail({ code, title, subtitle, hint }) {
    const safeTitle = title || "Qubite";
    const safeSubtitle = subtitle || "Ваш код подтверждения";
    const safeHint = hint || "Код действует ограниченное время.";

    return {
        subject: `${safeTitle}: код подтверждения`,
        text: `${safeSubtitle}\n\nКод: ${code}\n\n${safeHint}`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #101828; line-height: 1.5;">
                <h2 style="margin: 0 0 12px;">${safeTitle}</h2>
                <p style="margin: 0 0 16px;">${safeSubtitle}</p>
                <div style="display: inline-block; padding: 12px 18px; border-radius: 12px; background: linear-gradient(135deg, #f43f5e, #f59e0b); color: #fff; font-size: 24px; letter-spacing: 6px; font-weight: 700;">
                    ${code}
                </div>
                <p style="margin: 16px 0 0; color: #475467;">${safeHint}</p>
            </div>
        `,
    };
}

module.exports = {
    buildCodeEmail,
    sendEmail,
};
