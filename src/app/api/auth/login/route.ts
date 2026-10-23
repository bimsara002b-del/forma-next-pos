import { cookies } from "next/headers";
import { z } from "zod";
import { createSession, isConfigured, mutationAuthError, passwordMatches, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { newStaffSession, matchesPassword, staffMode } from "@/lib/staff";
export const runtime="nodejs";
const credentials=z.object({username:z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),password:z.string().min(1).max(128)}).strict();
export async function POST(request:Request) {
  const denied=mutationAuthError(request);if(denied)return denied;
  if(!isConfigured())return Response.json({error:"Run npm run setup to configure demo credentials."},{status:503});
  let body:unknown;try{body=await request.json();}catch{return Response.json({error:"Invalid JSON."},{status:400});}
  let session:string;
  if(staffMode()){
    const input=credentials.safeParse(body);
    if(!input.success)return Response.json({error:"Invalid username or password."},{status:401});
    const user=await prisma.staffUser.findUnique({where:{username:input.data.username}});
    if(!user?.isActive || !(await matchesPassword(input.data.password,user.passwordHash)))
      return Response.json({error:"Invalid username or password."},{status:401});
    session=newStaffSession(user.id,user.sessionVersion,process.env.POS_SESSION_SECRET!);
  }else{
    if(!body || typeof body!=="object" || !("password" in body) ||
      typeof body.password!=="string" || !passwordMatches(body.password))
      return Response.json({error:"Incorrect access password."},{status:401});
    session=createSession();
  }
  (await cookies()).set(SESSION_COOKIE,session,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:28800});
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
