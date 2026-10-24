/** Single-store Sri Lankan pilot business calendar (post-2006 UTC+05:30).
 * This does not imply tenant-configurable time zones or tax-period compliance.
 * Database timestamps stay UTC; only report boundaries/buckets are local.
 */
export const REPORT_TIMEZONE="Asia/Colombo";
export const COLOMBO_OFFSET_MS=330*60*1000;
const DAY_MS=86_400_000;
export function sriLankaDate(value:Date):string {
 if(!Number.isFinite(value.getTime()))throw Error("INVALID_REPORT_DATE");
 return new Date(value.getTime()+COLOMBO_OFFSET_MS).toISOString().slice(0,10);
}
export function dateDaysBefore(dateText:string,days:number):string {
 return new Date(Date.parse(dateText+"T00:00:00Z")-days*DAY_MS).toISOString().slice(0,10);
}
