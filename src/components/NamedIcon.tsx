import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import BeachAccessOutlinedIcon from "@mui/icons-material/BeachAccessOutlined";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import DirectionsBoatOutlinedIcon from "@mui/icons-material/DirectionsBoatOutlined";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import DirectionsTransitOutlinedIcon from "@mui/icons-material/DirectionsTransitOutlined";
import FlightTakeoffOutlinedIcon from "@mui/icons-material/FlightTakeoffOutlined";
import HandshakeOutlinedIcon from "@mui/icons-material/HandshakeOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import HotelOutlinedIcon from "@mui/icons-material/HotelOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalGasStationOutlinedIcon from "@mui/icons-material/LocalGasStationOutlined";
import LocalParkingOutlinedIcon from "@mui/icons-material/LocalParkingOutlined";
import MedicalServicesOutlinedIcon from "@mui/icons-material/MedicalServicesOutlined";
import PetsOutlinedIcon from "@mui/icons-material/PetsOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import RestaurantOutlinedIcon from "@mui/icons-material/RestaurantOutlined";
import SchoolOutlinedIcon from "@mui/icons-material/SchoolOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import ShoppingBagOutlinedIcon from "@mui/icons-material/ShoppingBagOutlined";
import ShoppingBasketOutlinedIcon from "@mui/icons-material/ShoppingBasketOutlined";
import SpaOutlinedIcon from "@mui/icons-material/SpaOutlined";
import SubscriptionsOutlinedIcon from "@mui/icons-material/SubscriptionsOutlined";
import SwapHorizOutlinedIcon from "@mui/icons-material/SwapHorizOutlined";
import WifiOutlinedIcon from "@mui/icons-material/WifiOutlined";
import type { SvgIconProps } from "@mui/material";

import { isIconName, type IconName } from "../../shared/icon-names";

const iconComponents = {
  expense: ReceiptLongOutlinedIcon,
  transfer: SwapHorizOutlinedIcon,
  promise: HandshakeOutlinedIcon,
  restaurant: RestaurantOutlinedIcon,
  grocery: ShoppingBasketOutlinedIcon,
  fuel: LocalGasStationOutlinedIcon,
  vehicle: DirectionsCarOutlinedIcon,
  parking: LocalParkingOutlinedIcon,
  transit: DirectionsTransitOutlinedIcon,
  home: HomeOutlinedIcon,
  household: Inventory2OutlinedIcon,
  "home-repair": HandymanOutlinedIcon,
  utilities: BoltOutlinedIcon,
  connectivity: WifiOutlinedIcon,
  medical: MedicalServicesOutlinedIcon,
  pet: PetsOutlinedIcon,
  shopping: ShoppingBagOutlinedIcon,
  entertainment: ConfirmationNumberOutlinedIcon,
  travel: FlightTakeoffOutlinedIcon,
  lodging: HotelOutlinedIcon,
  cruise: DirectionsBoatOutlinedIcon,
  finance: AccountBalanceOutlinedIcon,
  "personal-care": SpaOutlinedIcon,
  education: SchoolOutlinedIcon,
  insurance: ShieldOutlinedIcon,
  subscription: SubscriptionsOutlinedIcon,
  beach: BeachAccessOutlinedIcon,
} satisfies Record<IconName, typeof ReceiptLongOutlinedIcon>;

export function NamedIcon({ name, ...props }: { name: unknown } & SvgIconProps) {
  const Icon = isIconName(name) ? iconComponents[name] : ReceiptLongOutlinedIcon;
  return <Icon {...props} />;
}
