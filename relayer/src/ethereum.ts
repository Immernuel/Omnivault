import { ethers } from "ethers";
import { CONFIG } from "./config";

export const provider = new ethers.JsonRpcProvider(CONFIG.SEPOLIA_RPC);

export const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint amount)",
];

export const usdc = new ethers.Contract(
  CONFIG.USDC_ADDRESS,
  ERC20_ABI,
  provider,
);
