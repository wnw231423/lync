import { render } from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/index";

// 这里 mock 了 expo-router，这样大厅页在测试里无需真实导航容器也能渲染。
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
  },
  useFocusEffect: jest.fn(),
}));

// 这里 mock 了本地资料层，因为首页测试只关心头部用户信息是否正确展示。
jest.mock("@/features/travel/userDb", () => ({
  ensureCurrentUserProfileInDb: jest.fn().mockResolvedValue(null),
  getCurrentUserProfileFromDb: jest.fn().mockResolvedValue({
    id: "test-user",
    nickname: "旅行者",
    avatarLocalUri: "",
    avatarRemoteUrl: "",
  }),
}));

// HomeScreen 测试保留了一层轻量冒烟校验，确保旅行大厅入口页能正常渲染。
describe("<HomeScreen />", () => {
  test("renders empty lobby actions", () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText("创建空间")).toBeTruthy();
    expect(getByText("加入空间")).toBeTruthy();
  });
});
