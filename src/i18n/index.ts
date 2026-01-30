import en from "./locales/en";
import zhCn from "./locales/zh-cn";
import zhTw from "./locales/zh-tw";

const locales: { [key: string]: typeof en } = {
	en,
	"zh": zhCn,   
	"zh-tw": zhTw, 
};

export const t = (key: keyof typeof en): string => {
	const locale = window.localStorage.getItem("language") || "en";
	const strings = locales[locale.toLowerCase()] || en;
	return strings[key] || en[key];
	// return en[key];
};
