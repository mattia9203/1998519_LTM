import asyncio
from websockets.server import serve

async def handler(ws):
    print("Replica 9001 connessa")
    async for msg in ws:
        print("9001 <-", msg)

async def main():
    async with serve(handler, "0.0.0.0", 9001):
        await asyncio.Future()

asyncio.run(main())
