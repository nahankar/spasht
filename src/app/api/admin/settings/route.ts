// Legacy settings route removed; replaced by /api/admin/flags
export async function GET() {
	return new Response("Gone", { status: 410 });
}
export async function POST() {
	return new Response("Gone", { status: 410 });
}
